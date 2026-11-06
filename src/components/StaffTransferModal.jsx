import React, { useMemo, useState } from 'react';
import { ArrowRightLeft, X } from 'lucide-react';
import {
  collection,
  db,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  doc as fsDoc,
} from '../firebase.js';
import { personDisplayName } from '../utils/staffDirectory.js';
import {
  planStaffTransfer,
  summarizeTransferPlan,
} from '../utils/staffTransfer.js';

const BATCH_LIMIT = 400;

/**
 * Transfer active work (tasks, client access, sales ownership, inbox, digests)
 * from one staff email to another. Notes and historical attribution stay put.
 */
export default function StaffTransferModal({
  open,
  onClose,
  fromUser,
  targetOptions = [],
  clients = [],
  leads = [],
  deals = [],
  notifySettings = {},
  updateNotifySettings,
  updateDoc: updateDocProp,
  doc: docProp,
  logAudit,
}) {
  const update = updateDocProp || updateDoc;
  const docRef = docProp || ((coll, id) => fsDoc(db, coll, id));

  const fromEmail = String(fromUser?.email || '')
    .trim()
    .toLowerCase();
  const fromLabel = personDisplayName(fromUser, fromEmail);

  const [toEmail, setToEmail] = useState('');
  const [deactivateAfter, setDeactivateAfter] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const destinations = useMemo(
    () =>
      (targetOptions || []).filter(
        (u) =>
          String(u?.email || '')
            .trim()
            .toLowerCase() !== fromEmail,
      ),
    [targetOptions, fromEmail],
  );

  const plan = useMemo(
    () =>
      planStaffTransfer({
        fromEmail,
        toEmail,
        clients,
        leads,
        deals,
        digestRecipients: notifySettings?.emailDigestRecipients || [],
      }),
    [fromEmail, toEmail, clients, leads, deals, notifySettings],
  );

  if (!open || !fromEmail) return null;

  const runTransfer = async () => {
    if (busy) return;
    if (plan.errors.length) {
      setError(plan.errors[0]);
      return;
    }
    setBusy(true);
    setError('');
    try {
      let notificationCount = 0;

      for (const row of plan.clientPatches) {
        await update(docRef('clients', row.clientId), row.patch);
      }
      for (const row of plan.leadPatches) {
        await update(docRef('leads', row.id), row.patch);
      }
      for (const row of plan.dealPatches) {
        await update(docRef('deals', row.id), row.patch);
      }

      if (plan.digestChanged && typeof updateNotifySettings === 'function') {
        await updateNotifySettings({
          emailDigestRecipients: plan.digestRecipients,
        });
      }

      // Reassign open inbox items (admin may rewrite recipientEmail).
      const notifSnap = await getDocs(
        query(
          collection(db, 'notifications'),
          where('recipientEmail', '==', fromEmail),
        ),
      );
      const notifDocs = notifSnap.docs;
      notificationCount = notifDocs.length;
      for (let i = 0; i < notifDocs.length; i += BATCH_LIMIT) {
        const chunk = notifDocs.slice(i, i + BATCH_LIMIT);
        const batch = writeBatch(db);
        chunk.forEach((d) => {
          batch.update(d.ref, { recipientEmail: plan.toEmail });
        });
        await batch.commit();
      }

      if (deactivateAfter) {
        const now = Date.now();
        const deactivatePatch = {
          disabled: true,
          disabledAt: now,
          updatedAt: now,
          transferredToEmail: plan.toEmail,
        };
        const ids = Array.isArray(fromUser?.ids) ? fromUser.ids : [];
        await Promise.all(
          ids.map((id) =>
            update(docRef('admins', id), deactivatePatch).catch(() => {}),
          ),
        );
        // Always merge the canonical email-keyed doc used by security rules.
        await setDoc(
          docRef('admins', fromEmail),
          { email: fromEmail, ...deactivatePatch },
          { merge: true },
        );
      }

      logAudit?.({
        action: 'staff_transfer',
        fromEmail: plan.fromEmail,
        toEmail: plan.toEmail,
        summary: plan.summary,
        notifications: notificationCount,
        deactivated: deactivateAfter,
      });

      window.alert(
        `Transferred from ${fromLabel} to ${plan.toEmail}.\n\n${summarizeTransferPlan(
          plan,
          notificationCount,
        )}${
          deactivateAfter
            ? `\n\n${fromLabel} was deactivated. Their notes and history still show under their name.`
            : ''
        }`,
      );
      onClose?.();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[120] animate-in fade-in duration-200">
      <div className="bg-white rounded-[32px] w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95">
        <div className="flex items-start justify-between gap-3 p-6 border-b border-slate-100">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-orange-50 text-[#fd7414] flex items-center justify-center shrink-0 border border-orange-100">
              <ArrowRightLeft className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-black text-lg text-slate-900">Transfer work</h3>
              <p className="text-sm text-slate-500 font-medium mt-1 leading-snug">
                Move active assignments from{' '}
                <span className="text-slate-700 font-bold">{fromLabel}</span> to a
                replacement. Notes, comments, and timesheets stay attributed to{' '}
                {fromLabel}.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => !busy && onClose?.()}
            className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <label className="block space-y-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Transfer to
            </span>
            <select
              value={toEmail}
              onChange={(e) => setToEmail(e.target.value)}
              disabled={busy}
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#fd7414] disabled:opacity-40"
            >
              <option value="">Select replacement…</option>
              {destinations.map((u) => {
                const em = String(u.email || '')
                  .trim()
                  .toLowerCase();
                return (
                  <option key={em} value={em}>
                    {personDisplayName(u, em)}
                    {u.displayName ? ` (${em})` : ''}
                  </option>
                );
              })}
            </select>
          </label>

          {toEmail ? (
            <div className="rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3 text-sm text-slate-600 font-medium leading-snug">
              {plan.errors.length
                ? plan.errors[0]
                : summarizeTransferPlan(plan)}
              {!plan.errors.length && plan.total === 0 ? (
                <span className="block text-xs text-slate-400 mt-1">
                  You can still deactivate them so they lose access while keeping
                  their history.
                </span>
              ) : null}
            </div>
          ) : null}

          <label className="flex items-start gap-3 text-sm font-medium text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={deactivateAfter}
              onChange={(e) => setDeactivateAfter(e.target.checked)}
              disabled={busy}
              className="mt-1 rounded border-slate-300"
            />
            <span>
              Deactivate {fromLabel} after transfer
              <span className="block text-xs text-slate-400 font-medium mt-0.5">
                Removes login access. Keeps their profile so past notes still show
                their name.
              </span>
            </span>
          </label>

          {error ? (
            <p className="text-sm font-bold text-red-600 leading-snug">{error}</p>
          ) : null}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => onClose?.()}
              className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-3.5 rounded-2xl transition-all disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || !toEmail || plan.errors.length > 0}
              onClick={runTransfer}
              className="flex-1 bg-[#fd7414] hover:brightness-95 text-white font-bold py-3.5 rounded-2xl transition-all disabled:opacity-40"
            >
              {busy ? 'Transferring…' : 'Transfer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

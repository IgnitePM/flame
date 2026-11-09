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

function errMessage(err) {
  return err?.message || String(err || 'Unknown error');
}

/**
 * Transfer active work (tasks, client access, sales ownership, inbox, digests)
 * from one staff email to another. Notes and historical attribution stay put.
 *
 * Re-running is safe: it rewrites emails in place and does not create duplicate tasks.
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

  const scrubDepartedFromClients = async (goneEmail) => {
    const em = String(goneEmail || '')
      .trim()
      .toLowerCase();
    if (!em) return 0;
    let scrubbed = 0;
    for (const c of clients || []) {
      const raw = c?.teamMemberAccessEmails;
      if (!Array.isArray(raw) || !c?.id) continue;
      if (
        !raw.some(
          (e) =>
            String(e || '')
              .trim()
              .toLowerCase() === em,
        )
      ) {
        continue;
      }
      const next = raw
        .map((e) => String(e || '').trim().toLowerCase())
        .filter((e) => e && e !== em);
      try {
        await update(docRef('clients', c.id), {
          teamMemberAccessEmails: next,
        });
        scrubbed += 1;
      } catch {
        /* best-effort */
      }
    }
    return scrubbed;
  };

  const runTransfer = async () => {
    if (busy) return;
    if (plan.errors.length) {
      setError(plan.errors[0]);
      return;
    }
    setBusy(true);
    setError('');
    const warnings = [];
    let clientsOk = 0;
    let leadsOk = 0;
    let dealsOk = 0;
    let notificationCount = 0;
    let deactivated = false;

    try {
      // 1) Client task / access rewrites (core transfer — must succeed)
      for (const row of plan.clientPatches) {
        await update(docRef('clients', row.clientId), row.patch);
        clientsOk += 1;
      }

      // 2) Sales ownership — optional if Sales Funnel rules block the caller
      for (const row of plan.leadPatches) {
        try {
          await update(docRef('leads', row.id), row.patch);
          leadsOk += 1;
        } catch (err) {
          warnings.push(`Lead ownership: ${errMessage(err)}`);
        }
      }
      for (const row of plan.dealPatches) {
        try {
          await update(docRef('deals', row.id), row.patch);
          dealsOk += 1;
        } catch (err) {
          warnings.push(`Deal ownership: ${errMessage(err)}`);
        }
      }

      // 3) Digest recipients
      if (plan.digestChanged && typeof updateNotifySettings === 'function') {
        try {
          await updateNotifySettings({
            emailDigestRecipients: plan.digestRecipients,
          });
        } catch (err) {
          warnings.push(`Digest list: ${errMessage(err)}`);
        }
      }

      // 4) Inbox reassignment — best-effort (rules may block non-admin)
      try {
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
      } catch (err) {
        warnings.push(
          `Inbox notifications could not be moved (${errMessage(err)}). Task assignments were still transferred.`,
        );
        notificationCount = 0;
      }

      // 5) Deactivate + scrub ACLs — separate from transfer so a rules miss
      //    does not look like a failed transfer.
      if (deactivateAfter) {
        try {
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
          await setDoc(
            docRef('admins', fromEmail),
            { email: fromEmail, ...deactivatePatch },
            { merge: true },
          );
          await scrubDepartedFromClients(fromEmail);
          deactivated = true;
        } catch (err) {
          warnings.push(
            `Could not deactivate ${fromLabel} (${errMessage(err)}). Use the Deactivate button on their Users card.`,
          );
        }
      }

      logAudit?.({
        action: 'staff_transfer',
        fromEmail: plan.fromEmail,
        toEmail: plan.toEmail,
        summary: {
          ...plan.summary,
          clientsWritten: clientsOk,
          leadsWritten: leadsOk,
          dealsWritten: dealsOk,
        },
        notifications: notificationCount,
        deactivated,
        warnings,
      });

      const summaryBits = [
        summarizeTransferPlan(
          {
            ...plan,
            summary: {
              ...plan.summary,
              clients: clientsOk || plan.summary.clients,
              leads: leadsOk,
              deals: dealsOk,
            },
          },
          notificationCount,
        ),
      ];
      if (deactivateAfter) {
        summaryBits.push(
          deactivated
            ? `${fromLabel} was deactivated. Notes and history still show under their name.`
            : `${fromLabel} was NOT deactivated — use Deactivate on their Users card.`,
        );
      }
      if (warnings.length) {
        summaryBits.push(`Notes:\n- ${warnings.join('\n- ')}`);
      }
      summaryBits.push(
        'Re-running transfer does not duplicate tasks; it only rewrites remaining assignments.',
      );

      window.alert(
        `Transferred from ${fromLabel} to ${plan.toEmail}.\n\n${summaryBits.join('\n\n')}`,
      );

      if (warnings.length && !deactivated && deactivateAfter) {
        setError(warnings[warnings.length - 1]);
        return;
      }
      onClose?.();
    } catch (err) {
      setError(
        clientsOk > 0
          ? `Some work transferred (${clientsOk} client${clientsOk === 1 ? '' : 's'}), then failed: ${errMessage(err)}`
          : errMessage(err),
      );
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
                {fromLabel}. Safe to run more than once — it will not duplicate
                tasks.
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
                  Nothing left to reassign (already transferred, or they had no
                  active work). You can still deactivate them.
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
              {busy
                ? 'Transferring…'
                : plan.total === 0 && deactivateAfter
                  ? 'Deactivate'
                  : 'Transfer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

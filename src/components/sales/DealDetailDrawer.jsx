import React, { useEffect, useMemo, useState } from 'react';
import { Mail, X } from 'lucide-react';
import {
  formatDealAmount,
  formatDealDate,
  makeDealNote,
  normalizeDealAssociation,
  staffDisplayFromEmail,
  todayYmd,
} from '../../utils/salesPipeline.js';

export default function DealDetailDrawer({
  deal,
  stages = [],
  leads = [],
  clients = [],
  adminUsers = [],
  user,
  onClose,
  updateDoc,
  doc,
  setDeleteConfirm,
}) {
  const me = String(user?.email || '').trim().toLowerCase();
  const [draft, setDraft] = useState(null);
  const [noteBody, setNoteBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [assocType, setAssocType] = useState('lead');

  useEffect(() => {
    if (!deal) {
      setDraft(null);
      return;
    }
    setDraft({
      name: deal.name || '',
      amount: deal.amount ?? '',
      stageId: deal.stageId || stages[0]?.id || '',
      ownerEmail: deal.ownerEmail || me,
      closeDate: formatDealDate(deal.closeDate) === '—'
        ? ''
        : formatDealDate(deal.closeDate),
      lostReason: deal.lostReason || '',
      leadId: deal.leadId || '',
      clientId: deal.clientId || '',
    });
    setAssocType(deal.clientId ? 'client' : 'lead');
    setNoteBody('');
  }, [deal?.id, stages, me]);

  const openLeads = useMemo(
    () =>
      (leads || []).filter(
        (l) => l.status !== 'archived' && l.status !== 'converted',
      ),
    [leads],
  );

  const activeClients = useMemo(
    () =>
      (clients || []).filter((c) => !c.archived && c.status !== 'paused'),
    [clients],
  );

  if (!deal || !draft) return null;

  const stage = stages.find((s) => s.id === draft.stageId);
  const notes = Array.isArray(deal.notes) ? [...deal.notes].reverse() : [];

  const linkedEmail = (() => {
    if (assocType === 'lead' && draft.leadId) {
      const lead = leads.find((l) => l.id === draft.leadId);
      return lead?.primaryContact?.email || '';
    }
    if (assocType === 'client' && draft.clientId) {
      const client = clients.find((c) => c.id === draft.clientId);
      return (
        client?.primaryContact?.email ||
        (Array.isArray(client?.clientEmails) ? client.clientEmails[0] : '') ||
        ''
      );
    }
    return '';
  })();

  const save = async () => {
    setSaving(true);
    try {
      const assoc = normalizeDealAssociation({
        leadId: assocType === 'lead' ? draft.leadId : null,
        clientId: assocType === 'client' ? draft.clientId : null,
      });
      if (!assoc.leadId && !assoc.clientId) {
        window.alert('Link this deal to a lead or a client.');
        setSaving(false);
        return;
      }
      const amount = Number(draft.amount);
      const now = Date.now();
      const prevStage = deal.stageId;
      const patch = {
        name: draft.name.trim() || 'Untitled deal',
        amount: Number.isFinite(amount) ? amount : 0,
        stageId: draft.stageId,
        ownerEmail: String(draft.ownerEmail || me).trim().toLowerCase(),
        closeDate: draft.closeDate || null,
        lostReason: stage?.isLost ? draft.lostReason.trim() : '',
        leadId: assoc.leadId,
        clientId: assoc.clientId,
        updatedAt: now,
        lastActivityAt: now,
      };
      if (prevStage !== draft.stageId) {
        patch.stageChangedAt = now;
      }
      await updateDoc(doc('deals', deal.id), patch);
      onClose?.();
    } catch (err) {
      window.alert(`Could not save deal.\n\n${err?.message || String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const addNote = async () => {
    const body = noteBody.trim();
    if (!body) return;
    setSaving(true);
    try {
      const note = makeDealNote(body, me);
      const nextNotes = [...(deal.notes || []), note];
      const now = Date.now();
      await updateDoc(doc('deals', deal.id), {
        notes: nextNotes,
        updatedAt: now,
        lastActivityAt: now,
      });
      setNoteBody('');
    } catch (err) {
      window.alert(`Could not add note.\n\n${err?.message || String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-black/30">
      <button
        type="button"
        className="flex-1 cursor-default"
        aria-label="Close deal detail"
        onClick={onClose}
      />
      <div className="w-full max-w-lg h-full bg-white shadow-2xl overflow-y-auto p-6 space-y-5 animate-in slide-in-from-right duration-200">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">
              Deal
            </div>
            <h3 className="font-black text-xl text-slate-900 leading-tight">
              {draft.name || 'Untitled deal'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <label className="block text-xs font-bold text-slate-500 space-y-1">
          Deal name
          <input
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-bold text-slate-500 space-y-1">
            Amount (USD)
            <input
              type="number"
              min="0"
              step="1"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none"
              value={draft.amount}
              onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))}
            />
          </label>
          <label className="text-xs font-bold text-slate-500 space-y-1">
            Close date
            <input
              type="date"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none"
              value={draft.closeDate || ''}
              onChange={(e) => setDraft((d) => ({ ...d, closeDate: e.target.value }))}
            />
          </label>
        </div>

        <label className="block text-xs font-bold text-slate-500 space-y-1">
          Stage
          <select
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none"
            value={draft.stageId}
            onChange={(e) => setDraft((d) => ({ ...d, stageId: e.target.value }))}
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        {stage?.isLost && (
          <label className="block text-xs font-bold text-slate-500 space-y-1">
            Lost reason
            <input
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none"
              value={draft.lostReason}
              onChange={(e) =>
                setDraft((d) => ({ ...d, lostReason: e.target.value }))
              }
            />
          </label>
        )}

        <label className="block text-xs font-bold text-slate-500 space-y-1">
          Owner
          <select
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none"
            value={draft.ownerEmail}
            onChange={(e) =>
              setDraft((d) => ({ ...d, ownerEmail: e.target.value }))
            }
          >
            {(adminUsers || []).map((a) => {
              const email = String(a.email || a.id || '').toLowerCase();
              return (
                <option key={email} value={email}>
                  {staffDisplayFromEmail(email, adminUsers)}
                </option>
              );
            })}
          </select>
        </label>

        <div className="space-y-2">
          <div className="text-xs font-bold text-slate-500">Linked to</div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAssocType('lead')}
              className={`flex-1 px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wider ${
                assocType === 'lead'
                  ? 'bg-black text-white'
                  : 'bg-slate-100 text-slate-500'
              }`}
            >
              Lead
            </button>
            <button
              type="button"
              onClick={() => setAssocType('client')}
              className={`flex-1 px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wider ${
                assocType === 'client'
                  ? 'bg-black text-white'
                  : 'bg-slate-100 text-slate-500'
              }`}
            >
              Client
            </button>
          </div>
          {assocType === 'lead' ? (
            <select
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none"
              value={draft.leadId}
              onChange={(e) =>
                setDraft((d) => ({ ...d, leadId: e.target.value, clientId: '' }))
              }
            >
              <option value="">Select lead…</option>
              {openLeads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.companyName || l.name}
                </option>
              ))}
            </select>
          ) : (
            <select
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none"
              value={draft.clientId}
              onChange={(e) =>
                setDraft((d) => ({ ...d, clientId: e.target.value, leadId: '' }))
              }
            >
              <option value="">Select client…</option>
              {activeClients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="text-xs text-slate-400 font-medium">
          Created {formatDealDate(deal.createDate || deal.createdAt)} ·{' '}
          {formatDealAmount(deal.amount)}
        </div>

        {linkedEmail ? (
          <a
            href={`mailto:${encodeURIComponent(linkedEmail)}`}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-50 text-sky-800 text-xs font-bold"
          >
            <Mail className="w-3.5 h-3.5" /> Email contact
          </a>
        ) : null}

        <div className="border-t border-slate-100 pt-4 space-y-3">
          <div className="text-xs font-black uppercase tracking-widest text-slate-400">
            Notes
          </div>
          <textarea
            rows={3}
            placeholder="Record progress on this deal…"
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none resize-y"
            value={noteBody}
            onChange={(e) => setNoteBody(e.target.value)}
          />
          <button
            type="button"
            disabled={saving || !noteBody.trim()}
            onClick={addNote}
            className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-wider disabled:opacity-40"
          >
            Add note
          </button>
          <ul className="space-y-2 max-h-48 overflow-y-auto">
            {notes.length === 0 ? (
              <li className="text-xs italic text-slate-400">No notes yet.</li>
            ) : (
              notes.map((n) => (
                <li
                  key={n.id}
                  className="bg-slate-50 rounded-xl px-3 py-2 text-sm text-slate-700"
                >
                  <div className="text-[10px] font-bold text-slate-400 mb-1">
                    {staffDisplayFromEmail(n.authorEmail, adminUsers)} ·{' '}
                    {formatDealDate(n.createdAt)}
                  </div>
                  {n.body}
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="flex-1 bg-[#fd7414] text-white px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-wider disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save deal'}
          </button>
          <button
            type="button"
            onClick={() =>
              setDeleteConfirm?.({
                collection: 'deals',
                id: deal.id,
                title: `deal "${deal.name || 'Untitled'}"`,
              })
            }
            className="px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-wider text-red-500 bg-red-50"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

export function NewDealModal({
  open,
  onClose,
  stages = [],
  leads = [],
  clients = [],
  adminUsers = [],
  user,
  defaultLeadId = '',
  defaultClientId = '',
  defaultStageId = '',
  addDoc,
  collection,
}) {
  const me = String(user?.email || '').trim().toLowerCase();
  const [form, setForm] = useState({
    name: '',
    amount: '',
    stageId: '',
    ownerEmail: me,
    closeDate: '',
    assocType: defaultClientId ? 'client' : 'lead',
    leadId: defaultLeadId || '',
    clientId: defaultClientId || '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      name: '',
      amount: '',
      stageId: defaultStageId || stages[0]?.id || '',
      ownerEmail: me,
      closeDate: '',
      assocType: defaultClientId ? 'client' : 'lead',
      leadId: defaultLeadId || '',
      clientId: defaultClientId || '',
    });
  }, [open, defaultLeadId, defaultClientId, defaultStageId, stages, me]);

  if (!open) return null;

  const openLeads = (leads || []).filter(
    (l) => l.status !== 'archived' && l.status !== 'converted',
  );
  const activeClients = (clients || []).filter(
    (c) => !c.archived && c.status !== 'paused',
  );

  const submit = async () => {
    setSaving(true);
    try {
      const assoc = normalizeDealAssociation({
        leadId: form.assocType === 'lead' ? form.leadId : null,
        clientId: form.assocType === 'client' ? form.clientId : null,
      });
      if (!assoc.leadId && !assoc.clientId) {
        window.alert('Link this deal to a lead or a client.');
        setSaving(false);
        return;
      }
      const amount = Number(form.amount);
      const now = Date.now();
      let name = form.name.trim();
      if (!name) {
        if (assoc.leadId) {
          const lead = openLeads.find((l) => l.id === assoc.leadId);
          name = lead?.companyName || lead?.name || 'New deal';
        } else {
          const client = activeClients.find((c) => c.id === assoc.clientId);
          name = client?.name ? `${client.name} — New business` : 'New deal';
        }
      }
      await addDoc(collection('deals'), {
        name,
        amount: Number.isFinite(amount) ? amount : 0,
        stageId: form.stageId || stages[0]?.id || 'new_lead',
        ownerEmail: String(form.ownerEmail || me).trim().toLowerCase(),
        closeDate: form.closeDate || null,
        createDate: todayYmd(),
        leadId: assoc.leadId,
        clientId: assoc.clientId,
        lostReason: '',
        notes: [],
        createdAt: now,
        updatedAt: now,
        lastActivityAt: now,
        stageChangedAt: now,
      });
      onClose?.();
    } catch (err) {
      window.alert(`Could not create deal.\n\n${err?.message || String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-[28px] w-full max-w-md p-6 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="font-black text-lg">Add deal</h3>
          <button type="button" onClick={onClose} className="text-slate-400">
            <X className="w-5 h-5" />
          </button>
        </div>
        <label className="block text-xs font-bold text-slate-500 space-y-1">
          Deal name
          <input
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Optional — defaults from lead/client"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-bold text-slate-500 space-y-1">
            Amount
            <input
              type="number"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            />
          </label>
          <label className="text-xs font-bold text-slate-500 space-y-1">
            Close date
            <input
              type="date"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none"
              value={form.closeDate}
              onChange={(e) =>
                setForm((f) => ({ ...f, closeDate: e.target.value }))
              }
            />
          </label>
        </div>
        <label className="block text-xs font-bold text-slate-500 space-y-1">
          Stage
          <select
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none"
            value={form.stageId}
            onChange={(e) => setForm((f) => ({ ...f, stageId: e.target.value }))}
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, assocType: 'lead' }))}
            className={`flex-1 px-3 py-2 rounded-xl text-xs font-black uppercase ${
              form.assocType === 'lead' ? 'bg-black text-white' : 'bg-slate-100'
            }`}
          >
            Lead
          </button>
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, assocType: 'client' }))}
            className={`flex-1 px-3 py-2 rounded-xl text-xs font-black uppercase ${
              form.assocType === 'client' ? 'bg-black text-white' : 'bg-slate-100'
            }`}
          >
            Client
          </button>
        </div>
        {form.assocType === 'lead' ? (
          <select
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none"
            value={form.leadId}
            onChange={(e) => setForm((f) => ({ ...f, leadId: e.target.value }))}
          >
            <option value="">Select lead…</option>
            {openLeads.map((l) => (
              <option key={l.id} value={l.id}>
                {l.companyName || l.name}
              </option>
            ))}
          </select>
        ) : (
          <select
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none"
            value={form.clientId}
            onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}
          >
            <option value="">Select client…</option>
            {activeClients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 text-xs font-black uppercase text-slate-500"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={submit}
            className="bg-[#fd7414] text-white px-5 py-2.5 rounded-2xl text-xs font-black uppercase disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

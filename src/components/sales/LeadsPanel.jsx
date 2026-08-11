import React, { useMemo, useState } from 'react';
import { Mail, Trash2, UserPlus, X } from 'lucide-react';
import {
  formatRelativeActivity,
  staffDisplayFromEmail,
} from '../../utils/salesPipeline.js';

function emptyLeadForm(ownerEmail = '') {
  return {
    name: '',
    companyName: '',
    website: '',
    phone: '',
    notes: '',
    ownerEmail: ownerEmail || '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    contactTitle: '',
  };
}

export default function LeadsPanel({
  leads = [],
  deals = [],
  adminUsers = [],
  user,
  addDoc,
  updateDoc,
  collection,
  doc,
  onConvertLead,
  onOpenDeal,
}) {
  const me = String(user?.email || '').trim().toLowerCase();
  const [showConverted, setShowConverted] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(() => emptyLeadForm(me));
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const visibleLeads = useMemo(() => {
    return (leads || [])
      .filter((l) => {
        if (l.status === 'archived') return false;
        if (l.status === 'converted') return showConverted;
        return l.status !== 'converted';
      })
      .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  }, [leads, showConverted]);

  const openEdit = (lead) => {
    setEditingId(lead.id);
    setCreateOpen(false);
    setForm({
      name: lead.name || '',
      companyName: lead.companyName || '',
      website: lead.website || '',
      phone: lead.phone || '',
      notes: lead.notes || '',
      ownerEmail: lead.ownerEmail || me,
      contactName: lead.primaryContact?.name || '',
      contactEmail: lead.primaryContact?.email || '',
      contactPhone: lead.primaryContact?.phone || '',
      contactTitle: lead.primaryContact?.title || '',
    });
  };

  const openCreate = () => {
    setEditingId(null);
    setCreateOpen(true);
    setForm(emptyLeadForm(me));
  };

  const closeForm = () => {
    setEditingId(null);
    setCreateOpen(false);
    setForm(emptyLeadForm(me));
  };

  const buildPayload = () => {
    const now = Date.now();
    const primaryContact = {
      name: form.contactName.trim(),
      email: form.contactEmail.trim().toLowerCase(),
      phone: form.contactPhone.trim(),
      title: form.contactTitle.trim(),
    };
    return {
      name: form.name.trim() || form.companyName.trim() || 'Untitled lead',
      companyName: form.companyName.trim(),
      website: form.website.trim(),
      phone: form.phone.trim(),
      notes: form.notes.trim(),
      ownerEmail: String(form.ownerEmail || me).trim().toLowerCase(),
      primaryContact,
      contacts: primaryContact.name || primaryContact.email ? [primaryContact] : [],
      updatedAt: now,
      lastActivityAt: now,
    };
  };

  const saveLead = async () => {
    setSaving(true);
    try {
      const payload = buildPayload();
      if (editingId) {
        await updateDoc(doc('leads', editingId), payload);
      } else {
        await addDoc(collection('leads'), {
          ...payload,
          status: 'open',
          convertedClientId: null,
          createdAt: Date.now(),
        });
      }
      closeForm();
    } catch (err) {
      window.alert(`Could not save lead.\n\n${err?.message || String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const archiveLead = async (lead) => {
    if (!window.confirm(`Archive lead "${lead.name || lead.companyName}"?`)) return;
    try {
      await updateDoc(doc('leads', lead.id), {
        status: 'archived',
        updatedAt: Date.now(),
      });
      if (editingId === lead.id) closeForm();
    } catch (err) {
      window.alert(`Could not archive lead.\n\n${err?.message || String(err)}`);
    }
  };

  const formOpen = createOpen || !!editingId;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-black text-lg text-slate-800">Leads</h3>
          <p className="text-sm text-slate-400 font-medium">
            Prospects who are not clients yet. They never appear in the kiosk.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
            <input
              type="checkbox"
              checked={showConverted}
              onChange={(e) => setShowConverted(e.target.checked)}
            />
            Show converted
          </label>
          <button
            type="button"
            onClick={openCreate}
            className="bg-[#fd7414] text-white px-5 py-2.5 rounded-2xl text-xs font-black uppercase tracking-wider active:scale-95 transition-all hover:brightness-95"
          >
            Add lead
          </button>
        </div>
      </div>

      {formOpen && (
        <div className="bg-white border border-slate-200 rounded-[28px] p-6 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h4 className="font-black text-slate-800">
              {editingId ? 'Edit lead' : 'New lead'}
            </h4>
            <button type="button" onClick={closeForm} className="text-slate-400 hover:text-slate-700">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-xs font-bold text-slate-500 space-y-1">
              Lead / opportunity name
              <input
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-800 outline-none"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </label>
            <label className="text-xs font-bold text-slate-500 space-y-1">
              Company
              <input
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-800 outline-none"
                value={form.companyName}
                onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
              />
            </label>
            <label className="text-xs font-bold text-slate-500 space-y-1">
              Website
              <input
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-800 outline-none"
                value={form.website}
                onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
              />
            </label>
            <label className="text-xs font-bold text-slate-500 space-y-1">
              Phone
              <input
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-800 outline-none"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </label>
            <label className="text-xs font-bold text-slate-500 space-y-1 md:col-span-2">
              Owner
              <select
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-800 outline-none"
                value={form.ownerEmail}
                onChange={(e) => setForm((f) => ({ ...f, ownerEmail: e.target.value }))}
              >
                {(adminUsers || []).map((a) => {
                  const email = String(a.email || a.id || '').toLowerCase();
                  return (
                    <option key={email} value={email}>
                      {staffDisplayFromEmail(email, adminUsers)} ({email})
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-500 space-y-1">
              Contact name
              <input
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-800 outline-none"
                value={form.contactName}
                onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))}
              />
            </label>
            <label className="text-xs font-bold text-slate-500 space-y-1">
              Contact email
              <input
                type="email"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-800 outline-none"
                value={form.contactEmail}
                onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
              />
            </label>
            <label className="text-xs font-bold text-slate-500 space-y-1">
              Contact phone
              <input
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-800 outline-none"
                value={form.contactPhone}
                onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))}
              />
            </label>
            <label className="text-xs font-bold text-slate-500 space-y-1">
              Contact title
              <input
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-800 outline-none"
                value={form.contactTitle}
                onChange={(e) => setForm((f) => ({ ...f, contactTitle: e.target.value }))}
              />
            </label>
            <label className="text-xs font-bold text-slate-500 space-y-1 md:col-span-2">
              Notes
              <textarea
                rows={3}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-800 outline-none resize-y"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={closeForm}
              className="px-5 py-2.5 rounded-2xl text-xs font-black uppercase tracking-wider text-slate-500"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={saveLead}
              className="bg-[#fd7414] text-white px-6 py-2.5 rounded-2xl text-xs font-black uppercase tracking-wider disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {visibleLeads.length === 0 ? (
          <p className="text-sm italic text-slate-400 py-8 text-center">
            No leads yet. Add a prospect to start tracking them on the board.
          </p>
        ) : (
          visibleLeads.map((lead) => {
            const activity = formatRelativeActivity(lead.lastActivityAt || lead.updatedAt);
            const leadDeals = (deals || []).filter((d) => d.leadId === lead.id);
            const email = lead.primaryContact?.email;
            return (
              <div
                key={lead.id}
                className="bg-white border border-slate-100 rounded-[24px] p-5 shadow-sm flex flex-col md:flex-row md:items-center gap-4"
              >
                <button
                  type="button"
                  onClick={() => openEdit(lead)}
                  className="flex-1 text-left space-y-1"
                >
                  <div className="font-black text-slate-800">
                    {lead.name || lead.companyName || 'Untitled lead'}
                  </div>
                  <div className="text-xs font-bold text-slate-400">
                    {lead.companyName && lead.name ? lead.companyName : null}
                    {lead.primaryContact?.name
                      ? `${lead.companyName && lead.name ? ' · ' : ''}${lead.primaryContact.name}`
                      : null}
                    {' · '}
                    Owner: {staffDisplayFromEmail(lead.ownerEmail, adminUsers)}
                    {activity ? ` · Updated ${activity}` : ''}
                    {lead.status === 'converted' ? ' · Converted' : ''}
                  </div>
                  {leadDeals.length > 0 && (
                    <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 pt-1">
                      {leadDeals.length} deal{leadDeals.length === 1 ? '' : 's'}
                    </div>
                  )}
                </button>
                <div className="flex flex-wrap items-center gap-2">
                  {email ? (
                    <a
                      href={`mailto:${encodeURIComponent(email)}`}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-50 text-slate-600 text-xs font-bold hover:bg-slate-100"
                      title="Open in your email client"
                    >
                      <Mail className="w-3.5 h-3.5" /> Email
                    </a>
                  ) : null}
                  {lead.status !== 'converted' && (
                    <button
                      type="button"
                      onClick={() => onConvertLead?.(lead)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-100 text-emerald-700 text-xs font-bold hover:bg-emerald-100"
                    >
                      <UserPlus className="w-3.5 h-3.5" /> Convert to client
                    </button>
                  )}
                  {leadDeals[0] && (
                    <button
                      type="button"
                      onClick={() => onOpenDeal?.(leadDeals[0].id)}
                      className="px-3 py-2 rounded-xl bg-orange-50 text-[#fd7414] text-xs font-bold"
                    >
                      View deal
                    </button>
                  )}
                  {lead.status !== 'converted' && (
                    <button
                      type="button"
                      onClick={() => archiveLead(lead)}
                      className="p-2 text-slate-300 hover:text-red-500"
                      title="Archive"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export { emptyLeadForm };

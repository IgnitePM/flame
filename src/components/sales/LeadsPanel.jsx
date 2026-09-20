import React, { useMemo, useState } from 'react';
import { Mail, Plus, Sparkles, Trash2, UserPlus, X } from 'lucide-react';
import {
  formatRelativeActivity,
  leadDisplayName,
  staffDisplayFromEmail,
} from '../../utils/salesPipeline.js';
import { normalizeCompanyProfileFields } from '../../utils/clientCompanyProfile.js';
import {
  emptyPrimaryContact,
  newContactId,
  normalizeClientContacts,
  normalizePrimaryContact,
} from '../../utils/clientDocuments.js';
import { findDuplicateLeadGroups } from '../../utils/hubspotDealsImport.js';
import MentionTextarea from '../MentionTextarea.jsx';
import ClientActivityTimeline from '../ClientActivityTimeline.jsx';
import ClientEmailHistory from '../ClientEmailHistory.jsx';
import ClientEmailComposeModal from '../ClientEmailComposeModal.jsx';
import ClientEnrichPreviewModal from '../ClientEnrichPreviewModal.jsx';
import { buildLeadActivityDoc } from '../../utils/leadActivity.js';
import { authedFetch } from '../../utils/authedFetch.js';
import { db, addDoc as fbAddDoc, collection as fbCollection } from '../../firebase.js';

const inputClass =
  'w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#fd7414]';

function emptyLeadForm(ownerEmail = '') {
  const profile = normalizeCompanyProfileFields({});
  return {
    companyName: '',
    website: '',
    phone: '',
    notes: '',
    ownerEmail: ownerEmail || '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    contactTitle: '',
    extraContacts: [],
    ...profile,
  };
}

function formFromLead(lead, ownerFallback = '') {
  const profile = normalizeCompanyProfileFields(lead || {});
  const primary = normalizePrimaryContact(lead?.primaryContact);
  const allContacts = normalizeClientContacts(lead?.contacts);
  const extraContacts = allContacts.filter(
    (c) =>
      !(
        primary.email &&
        String(c.email || '').toLowerCase() === primary.email.toLowerCase() &&
        String(c.name || '').trim() === String(primary.name || '').trim()
      ),
  );
  return {
    companyName: String(lead?.companyName || lead?.name || '').trim(),
    website: String(lead?.website || '').trim(),
    phone: String(lead?.phone || '').trim(),
    notes: String(lead?.notes || '').trim(),
    ownerEmail: lead?.ownerEmail || ownerFallback || '',
    contactName: primary.name,
    contactEmail: primary.email,
    contactPhone: primary.phone,
    contactTitle: primary.title,
    extraContacts,
    ...profile,
  };
}

function replySubject(subject) {
  const s = String(subject || '').trim();
  if (!s) return 'Re:';
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

export default function LeadsPanel({
  leads = [],
  deals = [],
  adminUsers = [],
  staffEmails = [],
  notifyTextMentions,
  user,
  addDoc,
  updateDoc,
  collection,
  doc,
  onConvertLead,
  onOpenDeal,
  onAddDeal,
  onImport,
  canComposeEmail = false,
}) {
  const me = String(user?.email || '').trim().toLowerCase();
  const [showConverted, setShowConverted] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(() => emptyLeadForm(me));
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [detailTab, setDetailTab] = useState('activity');
  const [merging, setMerging] = useState(false);
  const [enrichBusy, setEnrichBusy] = useState(false);
  const [enrichPreview, setEnrichPreview] = useState(null);
  const [composeState, setComposeState] = useState(null);

  const duplicateGroups = useMemo(
    () => findDuplicateLeadGroups(leads),
    [leads],
  );

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
    setForm(formFromLead(lead, me));
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
    const companyName = form.companyName.trim();
    const primaryContact = normalizePrimaryContact({
      name: form.contactName,
      email: form.contactEmail,
      phone: form.contactPhone,
      title: form.contactTitle,
    });
    const extraContacts = normalizeClientContacts(form.extraContacts);
    const profile = normalizeCompanyProfileFields(form);
    return {
      // Keep `name` in sync with company for digests / legacy readers.
      name: companyName || 'Untitled lead',
      companyName,
      website: form.website.trim(),
      phone: form.phone.trim(),
      notes: form.notes.trim(),
      ownerEmail: String(form.ownerEmail || me).trim().toLowerCase(),
      primaryContact,
      contacts: extraContacts,
      ...profile,
      updatedAt: now,
      lastActivityAt: now,
    };
  };

  const saveLead = async () => {
    const companyName = form.companyName.trim();
    if (!companyName) {
      window.alert('Company name is required.');
      return;
    }
    setSaving(true);
    try {
      const payload = buildPayload();
      const prevNotes = editingId
        ? (leads || []).find((l) => l.id === editingId)?.notes || ''
        : '';
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
      notifyTextMentions?.({
        text: payload.notes,
        prevText: prevNotes,
        title: `Lead notes · ${leadDisplayName(payload)}`,
        clientName: leadDisplayName(payload, null),
        itemId: editingId || null,
      });
      closeForm();
    } catch (err) {
      window.alert(`Could not save lead.\n\n${err?.message || String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const archiveLead = async (lead) => {
    if (!window.confirm(`Archive lead "${leadDisplayName(lead)}"?`)) return;
    try {
      await updateDoc(doc('leads', lead.id), {
        status: 'archived',
        updatedAt: Date.now(),
      });
      if (editingId === lead.id) closeForm();
      if (expandedId === lead.id) setExpandedId(null);
    } catch (err) {
      window.alert(`Could not archive lead.\n\n${err?.message || String(err)}`);
    }
  };

  const mergeDuplicateLeads = async () => {
    if (!duplicateGroups.length || merging) return;
    const totalExtras = duplicateGroups.reduce(
      (n, g) => n + Math.max(0, g.leads.length - 1),
      0,
    );
    const ok = window.confirm(
      `Merge ${duplicateGroups.length} company group${
        duplicateGroups.length === 1 ? '' : 's'
      }? Keep the oldest lead in each group, move deals, and archive ${totalExtras} duplicate${
        totalExtras === 1 ? '' : 's'
      }.`,
    );
    if (!ok) return;
    setMerging(true);
    try {
      const now = Date.now();
      for (const group of duplicateGroups) {
        const [keeper, ...extras] = group.leads;
        for (const extra of extras) {
          const extraDeals = (deals || []).filter((d) => d.leadId === extra.id);
          await Promise.all(
            extraDeals.map((d) =>
              updateDoc(doc('deals', d.id), {
                leadId: keeper.id,
                updatedAt: now,
                lastActivityAt: now,
              }),
            ),
          );
          await updateDoc(doc('leads', extra.id), {
            status: 'archived',
            mergedIntoLeadId: keeper.id,
            notes: `${extra.notes || ''}\n\n[Merged into ${
              leadDisplayName(keeper, keeper.id)
            } on ${new Date(now).toISOString().slice(0, 10)}]`.trim(),
            updatedAt: now,
            lastActivityAt: now,
          });
        }
        await updateDoc(doc('leads', keeper.id), {
          updatedAt: now,
          lastActivityAt: now,
        });
      }
      window.alert('Duplicate leads merged.');
    } catch (err) {
      window.alert(`Could not merge leads.\n\n${err?.message || String(err)}`);
    } finally {
      setMerging(false);
    }
  };

  const logLeadActivity = async (entry) => {
    const docData = buildLeadActivityDoc({
      ...entry,
      actorEmail: entry?.actorEmail || user?.email || 'system',
      at: entry?.at || Date.now(),
    });
    await fbAddDoc(fbCollection(db, 'leadActivities'), docData);
    if (entry?.leadId) {
      try {
        await updateDoc(doc('leads', entry.leadId), {
          updatedAt: Date.now(),
          lastActivityAt: Date.now(),
        });
      } catch {
        /* non-fatal */
      }
    }
  };

  const runEnrich = async (lead) => {
    const website = String(lead?.website || '').trim();
    if (!website || enrichBusy) return;
    setEnrichBusy(true);
    try {
      const resp = await authedFetch('/.netlify/functions/enrich-client-from-website', {
        website,
        companyName: leadDisplayName(lead, ''),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Enrichment failed');
      setEnrichPreview({
        lead,
        suggestion: data.suggestion || data,
        meta: data.meta || null,
      });
    } catch (err) {
      window.alert(err?.message || 'Enrichment failed');
    } finally {
      setEnrichBusy(false);
    }
  };

  const applyEnrich = async (nextLead) => {
    if (!enrichPreview?.lead?.id) return;
    const leadId = enrichPreview.lead.id;
    const companyName = String(
      nextLead.companyName || nextLead.name || enrichPreview.lead.companyName || '',
    ).trim();
    const primaryContact =
      normalizePrimaryContact(nextLead.primaryContact) || emptyPrimaryContact();
    const profile = normalizeCompanyProfileFields(nextLead);
    const existingExtra = normalizeClientContacts(enrichPreview.lead.contacts);
    await updateDoc(doc('leads', leadId), {
      name: companyName || leadDisplayName(enrichPreview.lead),
      companyName: companyName || leadDisplayName(enrichPreview.lead, ''),
      website: nextLead.website || enrichPreview.lead.website || '',
      phone: nextLead.phone || enrichPreview.lead.phone || '',
      ...profile,
      primaryContact,
      contacts: existingExtra,
      updatedAt: Date.now(),
      lastActivityAt: Date.now(),
    });
    setEnrichPreview(null);
  };

  const formOpen = createOpen || !!editingId;
  const leadAsEntity = (lead) =>
    lead
      ? {
          ...lead,
          name: leadDisplayName(lead, 'Lead'),
        }
      : null;

  const setFormField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-black text-lg text-slate-800">Leads</h3>
          <p className="text-sm text-slate-400 font-medium">
            Prospect companies — same kind of profile as clients, before they convert.
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
          {duplicateGroups.length > 0 ? (
            <button
              type="button"
              disabled={merging}
              onClick={mergeDuplicateLeads}
              className="px-5 py-2.5 rounded-2xl text-xs font-black uppercase tracking-wider bg-amber-50 text-amber-800 hover:bg-amber-100 disabled:opacity-50"
            >
              {merging
                ? 'Merging…'
                : `Merge duplicate leads (${duplicateGroups.length})`}
            </button>
          ) : null}
          {onImport ? (
            <button
              type="button"
              onClick={onImport}
              className="px-5 py-2.5 rounded-2xl text-xs font-black uppercase tracking-wider bg-slate-100 text-slate-700 hover:bg-slate-200"
            >
              Import CSV
            </button>
          ) : null}
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
        <div className="bg-white border border-slate-200 rounded-[28px] p-6 space-y-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h4 className="font-black text-slate-800">
              {editingId ? 'Edit lead' : 'New lead'}
            </h4>
            <button type="button" onClick={closeForm} className="text-slate-400 hover:text-slate-700">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-3">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              Company
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="text-xs font-bold text-slate-500 space-y-1 md:col-span-2">
                Company name *
                <input
                  className={inputClass}
                  value={form.companyName}
                  onChange={(e) => setFormField('companyName', e.target.value)}
                  placeholder="Acme Co"
                  required
                />
              </label>
              <label className="text-xs font-bold text-slate-500 space-y-1">
                Website
                <input
                  className={inputClass}
                  value={form.website}
                  onChange={(e) => setFormField('website', e.target.value)}
                  placeholder="https://"
                />
              </label>
              <label className="text-xs font-bold text-slate-500 space-y-1">
                Phone
                <input
                  className={inputClass}
                  value={form.phone}
                  onChange={(e) => setFormField('phone', e.target.value)}
                />
              </label>
              <label className="text-xs font-bold text-slate-500 space-y-1">
                Industry
                <input
                  className={inputClass}
                  value={form.industry}
                  onChange={(e) => setFormField('industry', e.target.value)}
                />
              </label>
              <label className="text-xs font-bold text-slate-500 space-y-1 md:col-span-2">
                About
                <textarea
                  className={`${inputClass} font-medium min-h-[80px] resize-y`}
                  value={form.companyDescription}
                  onChange={(e) => setFormField('companyDescription', e.target.value)}
                  placeholder="Short company description…"
                />
              </label>
              <label className="text-xs font-bold text-slate-500 space-y-1 md:col-span-2">
                Street address
                <input
                  className={inputClass}
                  value={form.address}
                  onChange={(e) => setFormField('address', e.target.value)}
                />
              </label>
              <label className="text-xs font-bold text-slate-500 space-y-1">
                City
                <input
                  className={inputClass}
                  value={form.city}
                  onChange={(e) => setFormField('city', e.target.value)}
                />
              </label>
              <label className="text-xs font-bold text-slate-500 space-y-1">
                State / province
                <input
                  className={inputClass}
                  value={form.region}
                  onChange={(e) => setFormField('region', e.target.value)}
                />
              </label>
              <label className="text-xs font-bold text-slate-500 space-y-1">
                Postal code
                <input
                  className={inputClass}
                  value={form.postalCode}
                  onChange={(e) => setFormField('postalCode', e.target.value)}
                />
              </label>
              <label className="text-xs font-bold text-slate-500 space-y-1">
                Country
                <input
                  className={inputClass}
                  value={form.country}
                  onChange={(e) => setFormField('country', e.target.value)}
                />
              </label>
              <label className="text-xs font-bold text-slate-500 space-y-1 md:col-span-2">
                Google Business Profile
                <input
                  className={inputClass}
                  value={form.googleBusinessProfileUrl}
                  onChange={(e) => setFormField('googleBusinessProfileUrl', e.target.value)}
                />
              </label>
              <label className="text-xs font-bold text-slate-500 space-y-1">
                LinkedIn
                <input
                  className={inputClass}
                  value={form.linkedinUrl}
                  onChange={(e) => setFormField('linkedinUrl', e.target.value)}
                />
              </label>
              <label className="text-xs font-bold text-slate-500 space-y-1">
                Facebook
                <input
                  className={inputClass}
                  value={form.facebookUrl}
                  onChange={(e) => setFormField('facebookUrl', e.target.value)}
                />
              </label>
              <label className="text-xs font-bold text-slate-500 space-y-1">
                Instagram
                <input
                  className={inputClass}
                  value={form.instagramUrl}
                  onChange={(e) => setFormField('instagramUrl', e.target.value)}
                />
              </label>
              <label className="text-xs font-bold text-slate-500 space-y-1">
                X / Twitter
                <input
                  className={inputClass}
                  value={form.twitterUrl}
                  onChange={(e) => setFormField('twitterUrl', e.target.value)}
                />
              </label>
              <label className="text-xs font-bold text-slate-500 space-y-1 md:col-span-2">
                Owner
                <select
                  className={inputClass}
                  value={form.ownerEmail}
                  onChange={(e) => setFormField('ownerEmail', e.target.value)}
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
            </div>
          </div>

          <div className="space-y-3 border-t border-slate-100 pt-4">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              Primary contact
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="text-xs font-bold text-slate-500 space-y-1">
                Name
                <input
                  className={inputClass}
                  value={form.contactName}
                  onChange={(e) => setFormField('contactName', e.target.value)}
                />
              </label>
              <label className="text-xs font-bold text-slate-500 space-y-1">
                Title
                <input
                  className={inputClass}
                  value={form.contactTitle}
                  onChange={(e) => setFormField('contactTitle', e.target.value)}
                />
              </label>
              <label className="text-xs font-bold text-slate-500 space-y-1">
                Email
                <input
                  type="email"
                  className={inputClass}
                  value={form.contactEmail}
                  onChange={(e) => setFormField('contactEmail', e.target.value)}
                />
              </label>
              <label className="text-xs font-bold text-slate-500 space-y-1">
                Phone
                <input
                  className={inputClass}
                  value={form.contactPhone}
                  onChange={(e) => setFormField('contactPhone', e.target.value)}
                />
              </label>
            </div>
          </div>

          <div className="space-y-3 border-t border-slate-100 pt-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                Additional contacts
              </p>
              <button
                type="button"
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    extraContacts: [
                      ...(f.extraContacts || []),
                      {
                        id: newContactId(),
                        name: '',
                        email: '',
                        phone: '',
                        title: '',
                        notes: '',
                      },
                    ],
                  }))
                }
                className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-[#fd7414]"
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </div>
            {(form.extraContacts || []).length === 0 ? (
              <p className="text-sm text-slate-400 italic">No additional contacts yet.</p>
            ) : (
              <div className="space-y-3">
                {form.extraContacts.map((c, idx) => (
                  <div
                    key={c.id || idx}
                    className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3"
                  >
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            extraContacts: f.extraContacts.filter((_, i) => i !== idx),
                          }))
                        }
                        className="text-slate-400 hover:text-red-500 p-1"
                        title="Remove contact"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {['name', 'title', 'email', 'phone'].map((key) => (
                        <label
                          key={key}
                          className="text-xs font-bold text-slate-500 space-y-1"
                        >
                          {key.charAt(0).toUpperCase() + key.slice(1)}
                          <input
                            type={key === 'email' ? 'email' : 'text'}
                            className={inputClass}
                            value={c[key] || ''}
                            onChange={(e) => {
                              const value = e.target.value;
                              setForm((f) => ({
                                ...f,
                                extraContacts: f.extraContacts.map((row, i) =>
                                  i === idx ? { ...row, [key]: value } : row,
                                ),
                              }));
                            }}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <label className="text-xs font-bold text-slate-500 space-y-1 block border-t border-slate-100 pt-4">
            Notes
            <MentionTextarea
              rows={3}
              textareaClassName="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-800 outline-none resize-y"
              value={form.notes}
              onChange={(next) => setFormField('notes', next)}
              staffEmails={staffEmails}
              adminUsers={adminUsers}
              placeholder="Notes… Use @name to tag a teammate"
            />
          </label>

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
            No leads yet. Add a prospect company to start tracking deals.
          </p>
        ) : (
          visibleLeads.map((lead) => {
            const activity = formatRelativeActivity(lead.lastActivityAt || lead.updatedAt);
            const leadDeals = (deals || []).filter((d) => d.leadId === lead.id);
            const email = lead.primaryContact?.email;
            const isExpanded = expandedId === lead.id;
            const title = leadDisplayName(lead);
            const contactLine = lead.primaryContact?.name || lead.primaryContact?.email || '';
            return (
              <div
                key={lead.id}
                className="bg-white border border-slate-100 rounded-[24px] p-5 shadow-sm space-y-4"
              >
                <div className="flex flex-col md:flex-row md:items-center gap-4">
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedId(isExpanded ? null : lead.id);
                      setDetailTab('activity');
                    }}
                    className="flex-1 text-left space-y-1"
                  >
                    <div className="font-black text-slate-800">{title}</div>
                    <div className="text-xs font-bold text-slate-400">
                      {contactLine ? `${contactLine} · ` : ''}
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
                    {lead.status !== 'converted' && onAddDeal ? (
                      <button
                        type="button"
                        onClick={() => onAddDeal({ leadId: lead.id })}
                        className="px-3 py-2 rounded-xl bg-orange-50 text-[#fd7414] text-xs font-bold"
                      >
                        Add deal
                      </button>
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
                        className="px-3 py-2 rounded-xl bg-slate-50 text-slate-600 text-xs font-bold hover:bg-slate-100"
                      >
                        View deal
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openEdit(lead)}
                      className="px-3 py-2 rounded-xl bg-slate-50 text-slate-600 text-xs font-bold hover:bg-slate-100"
                    >
                      Edit
                    </button>
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

                {isExpanded ? (
                  <div className="border-t border-slate-100 pt-4 space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {[
                        { id: 'activity', label: 'Activity' },
                        { id: 'emails', label: 'Emails' },
                        { id: 'enrich', label: 'Enrich' },
                      ].map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setDetailTab(t.id)}
                          className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest ${
                            detailTab === t.id
                              ? 'bg-black text-white'
                              : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                    {detailTab === 'activity' ? (
                      <ClientActivityTimeline
                        entity={leadAsEntity(lead)}
                        entityKind="lead"
                        logActivity={logLeadActivity}
                        canCompose
                      />
                    ) : null}
                    {detailTab === 'emails' ? (
                      <ClientEmailHistory
                        entity={leadAsEntity(lead)}
                        entityKind="lead"
                        canCompose={canComposeEmail}
                        onCompose={(ent) =>
                          setComposeState({ lead: ent, mode: 'compose' })
                        }
                        onReply={(m) =>
                          setComposeState({
                            lead: leadAsEntity(lead),
                            mode: 'reply',
                            message: m,
                          })
                        }
                      />
                    ) : null}
                    {detailTab === 'enrich' ? (
                      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                        <p className="text-sm text-slate-500 font-medium">
                          Pull public company info from the lead website into empty fields for review.
                        </p>
                        <button
                          type="button"
                          disabled={
                            enrichBusy || !String(lead.website || '').trim()
                          }
                          onClick={() => runEnrich(lead)}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-black text-white text-[10px] font-black uppercase tracking-widest disabled:opacity-40"
                        >
                          <Sparkles
                            className={`w-3.5 h-3.5 ${enrichBusy ? 'animate-pulse' : ''}`}
                          />
                          {enrichBusy ? 'Enriching…' : 'Enrich from website'}
                        </button>
                        {!String(lead.website || '').trim() ? (
                          <p className="text-xs font-bold text-amber-700">
                            Add a website on the lead first (Edit).
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {composeState?.lead ? (
        <ClientEmailComposeModal
          entity={composeState.lead}
          entityKind="lead"
          onClose={() => setComposeState(null)}
          initialSubject={
            composeState.mode === 'reply'
              ? replySubject(composeState.message?.subject)
              : ''
          }
          initialTo={
            composeState.mode === 'reply'
              ? composeState.message?.direction === 'inbound'
                ? [composeState.message?.from].filter(Boolean)
                : composeState.message?.to || []
              : null
          }
          initialBody=""
          inReplyToId={
            composeState.mode === 'reply' ? composeState.message?.id || null : null
          }
        />
      ) : null}

      {enrichPreview?.lead ? (
        <ClientEnrichPreviewModal
          client={enrichPreview.lead}
          suggestion={enrichPreview.suggestion}
          meta={enrichPreview.meta}
          onClose={() => setEnrichPreview(null)}
          onApply={(next) => {
            applyEnrich(next).catch((err) =>
              window.alert(err?.message || 'Could not apply enrichment'),
            );
          }}
        />
      ) : null}
    </div>
  );
}

export { emptyLeadForm };

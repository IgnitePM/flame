import React, { useEffect, useState } from 'react';
import { db, doc, updateDoc } from '../firebase.js';
import { normalizeCompanyProfileFields } from '../utils/clientCompanyProfile.js';
import {
  emptyPrimaryContact,
  newContactId,
  normalizeClientContacts,
  normalizePrimaryContact,
} from '../utils/clientDocuments.js';
import { Save, Plus, Trash2 } from 'lucide-react';

const inputClass =
  'w-full bg-white border border-slate-200 p-3.5 rounded-xl font-medium text-sm outline-none focus:ring-2 focus:ring-[#fd7414]';

function buildDraft(client) {
  const profile = normalizeCompanyProfileFields(client || {});
  return {
    website: String(client?.website || '').trim(),
    phone: String(client?.phone || '').trim(),
    ...profile,
    primaryContact: normalizePrimaryContact(client?.primaryContact) || emptyPrimaryContact(),
    contacts: normalizeClientContacts(client?.contacts),
  };
}

function Field({ label, children }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
        {label}
      </label>
      {children}
    </div>
  );
}

/** Client-editable company profile (contacts, address, phone, socials). */
export default function PortalCompanyProfilePanel({ client }) {
  const [draft, setDraft] = useState(() => buildDraft(client));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setDraft(buildDraft(client));
  }, [client?.id]);

  const setField = (key, value) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setMessage('');
  };

  const save = async () => {
    if (!client?.id || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const profile = normalizeCompanyProfileFields(draft);
      await updateDoc(doc(db, 'clients', client.id), {
        website: String(draft.website || '').trim(),
        phone: String(draft.phone || '').trim(),
        ...profile,
        primaryContact: normalizePrimaryContact(draft.primaryContact),
        contacts: normalizeClientContacts(draft.contacts),
      });
      setMessage('Saved.');
    } catch (err) {
      setMessage(err?.message || 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white p-8 sm:p-10 rounded-[40px] shadow-sm border border-slate-100 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-black text-xl text-slate-900">Company profile</h3>
          <p className="text-sm text-slate-500 font-medium mt-1">
            Keep your contact details and public company info up to date for Ignite.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-black text-white text-xs font-black uppercase tracking-widest disabled:opacity-40"
        >
          <Save className="w-3.5 h-3.5" />
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
      {message ? (
        <p
          className={`text-sm font-bold ${
            message === 'Saved.' ? 'text-emerald-600' : 'text-red-500'
          }`}
        >
          {message}
        </p>
      ) : null}

      <section className="space-y-4">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">About</p>
        <Field label="Website">
          <input
            type="url"
            className={inputClass}
            value={draft.website}
            onChange={(e) => setField('website', e.target.value)}
            placeholder="https://example.com"
          />
        </Field>
        <Field label="About">
          <textarea
            className={`${inputClass} min-h-[96px]`}
            value={draft.companyDescription}
            onChange={(e) => setField('companyDescription', e.target.value)}
            placeholder="Short company description…"
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Industry">
            <input
              type="text"
              className={inputClass}
              value={draft.industry}
              onChange={(e) => setField('industry', e.target.value)}
            />
          </Field>
          <Field label="Phone">
            <input
              type="tel"
              className={inputClass}
              value={draft.phone}
              onChange={(e) => setField('phone', e.target.value)}
            />
          </Field>
        </div>
      </section>

      <section className="space-y-4 pt-4 border-t border-slate-100">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Address</p>
        <Field label="Street address">
          <input
            type="text"
            className={inputClass}
            value={draft.address}
            onChange={(e) => setField('address', e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="City">
            <input
              type="text"
              className={inputClass}
              value={draft.city}
              onChange={(e) => setField('city', e.target.value)}
            />
          </Field>
          <Field label="Province">
            <input
              type="text"
              className={inputClass}
              value={draft.region}
              onChange={(e) => setField('region', e.target.value)}
            />
          </Field>
          <Field label="Postal">
            <input
              type="text"
              className={inputClass}
              value={draft.postalCode}
              onChange={(e) => setField('postalCode', e.target.value)}
            />
          </Field>
          <Field label="Country">
            <input
              type="text"
              className={inputClass}
              value={draft.country}
              onChange={(e) => setField('country', e.target.value)}
            />
          </Field>
        </div>
      </section>

      <section className="space-y-4 pt-4 border-t border-slate-100">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
          Social & Google Business
        </p>
        <Field label="Google Business Profile URL">
          <input
            type="url"
            className={inputClass}
            value={draft.googleBusinessProfileUrl}
            onChange={(e) => setField('googleBusinessProfileUrl', e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            ['linkedinUrl', 'LinkedIn'],
            ['facebookUrl', 'Facebook'],
            ['instagramUrl', 'Instagram'],
            ['twitterUrl', 'X / Twitter'],
          ].map(([key, label]) => (
            <Field key={key} label={label}>
              <input
                type="url"
                className={inputClass}
                value={draft[key]}
                onChange={(e) => setField(key, e.target.value)}
              />
            </Field>
          ))}
        </div>
      </section>

      <section className="space-y-4 pt-4 border-t border-slate-100">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
          Primary contact
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {['name', 'title', 'email', 'phone'].map((key) => (
            <Field key={key} label={key.charAt(0).toUpperCase() + key.slice(1)}>
              <input
                type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'}
                className={inputClass}
                value={draft.primaryContact?.[key] || ''}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    primaryContact: { ...d.primaryContact, [key]: e.target.value },
                  }))
                }
              />
            </Field>
          ))}
        </div>
      </section>

      <section className="space-y-4 pt-4 border-t border-slate-100">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            Additional contacts
          </p>
          <button
            type="button"
            onClick={() =>
              setDraft((d) => ({
                ...d,
                contacts: [
                  ...(d.contacts || []),
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
        {(draft.contacts || []).length === 0 ? (
          <p className="text-sm text-slate-400 italic">No additional contacts yet.</p>
        ) : (
          <div className="space-y-4">
            {draft.contacts.map((c, idx) => (
              <div
                key={c.id || idx}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3"
              >
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        contacts: d.contacts.filter((_, i) => i !== idx),
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
                    <Field key={key} label={key.charAt(0).toUpperCase() + key.slice(1)}>
                      <input
                        type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'}
                        className={inputClass}
                        value={c[key] || ''}
                        onChange={(e) => {
                          const value = e.target.value;
                          setDraft((d) => ({
                            ...d,
                            contacts: d.contacts.map((row, i) =>
                              i === idx ? { ...row, [key]: value } : row,
                            ),
                          }));
                        }}
                      />
                    </Field>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

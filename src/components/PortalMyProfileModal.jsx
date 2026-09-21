import React, { useEffect, useState } from 'react';
import { User, X } from 'lucide-react';
import { authedFetch } from '../utils/authedFetch.js';
import { auth, updateProfile } from '../firebase.js';

/**
 * Portal user profile editor (name / title / phone) — mirrors contact-detail fields.
 */
export default function PortalMyProfileModal({
  open,
  onClose,
  initialProfile = {},
  onSaved,
}) {
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(String(initialProfile.name || initialProfile.displayName || '').trim());
    setTitle(String(initialProfile.title || '').trim());
    setPhone(String(initialProfile.phone || '').trim());
    setError('');
    setOkMsg('');
  }, [open, initialProfile]);

  if (!open) return null;

  const save = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    if (!String(name || '').trim()) {
      setError('Name is required.');
      return;
    }
    setBusy(true);
    setError('');
    setOkMsg('');
    try {
      const resp = await authedFetch('/.netlify/functions/portal-update-profile', {
        name: String(name).trim(),
        title: String(title).trim(),
        phone: String(phone).trim(),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data?.error) {
        throw new Error(data.error || 'Could not save profile.');
      }
      try {
        if (auth.currentUser && data.profile?.name) {
          await updateProfile(auth.currentUser, {
            displayName: data.profile.name,
          });
        }
      } catch {
        /* Auth profile sync is best-effort */
      }
      setOkMsg('Profile saved.');
      onSaved?.(data.profile);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative w-full sm:max-w-md bg-white rounded-t-[28px] sm:rounded-[28px] shadow-2xl border border-slate-100 p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
              <User className="w-5 h-5 text-[#fd7414]" />
              Your profile
            </h3>
            <p className="text-xs font-medium text-slate-500 mt-1">
              Used for @mentions and messages instead of your email prefix.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:bg-slate-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={save} className="space-y-3">
          <label className="block space-y-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Full name
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-[#fd7414]"
              required
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Job title
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-[#fd7414]"
              placeholder="Optional"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Phone
            </span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-[#fd7414]"
              placeholder="Optional"
            />
          </label>
          {error ? (
            <p className="text-sm font-bold text-red-600">{error}</p>
          ) : null}
          {okMsg ? (
            <p className="text-sm font-bold text-emerald-700">{okMsg}</p>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-black text-white py-3.5 rounded-2xl font-black disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save profile'}
          </button>
        </form>
      </div>
    </div>
  );
}

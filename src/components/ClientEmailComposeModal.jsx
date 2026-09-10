import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { authedFetch } from '../utils/authedFetch.js';
import { normalizePrimaryContact, normalizeClientContacts } from '../utils/clientDocuments.js';
import { normalizePortalEmailList } from '../utils/portalAccess.js';

function collectRecipientOptions(entity) {
  const opts = [];
  const seen = new Set();
  const add = (email, label) => {
    const em = String(email || '').trim().toLowerCase();
    if (!em || !em.includes('@') || seen.has(em)) return;
    seen.add(em);
    opts.push({ email: em, label: label || em });
  };
  const primary = normalizePrimaryContact(entity?.primaryContact);
  if (primary.email) add(primary.email, `${primary.name || 'Primary'} · ${primary.email}`);
  for (const c of normalizeClientContacts(entity?.contacts)) {
    if (c.email) add(c.email, `${c.name || 'Contact'} · ${c.email}`);
  }
  for (const em of normalizePortalEmailList(entity?.clientEmails)) {
    add(em, `Portal · ${em}`);
  }
  return opts;
}

function replySubject(subject) {
  const s = String(subject || '').trim();
  if (!s) return 'Re:';
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

/**
 * Admin/billing compose modal — sends via the caller's connected Gmail (OAuth).
 * Supports client or lead via entityKind. Legacy `client` prop still works.
 */
export default function ClientEmailComposeModal({
  client,
  entity,
  entityKind = 'client',
  onClose,
  initialSubject = '',
  initialTo = null,
  initialBody = '',
  inReplyToId = null,
}) {
  const resolved = entity || client;
  const kind = entity ? entityKind : 'client';
  const options = useMemo(() => collectRecipientOptions(resolved), [resolved]);
  const [selected, setSelected] = useState([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [gmail, setGmail] = useState({ loading: true, connected: false, email: '' });

  const initialToKey = Array.isArray(initialTo) ? initialTo.join(',') : '';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await authedFetch('/.netlify/functions/gmail-oauth-status', {});
        const data = await resp.json().catch(() => ({}));
        if (cancelled) return;
        if (!resp.ok) throw new Error(data.error || 'Could not check Gmail');
        setGmail({
          loading: false,
          connected: Boolean(data.connected),
          email: data.gmailEmail || '',
        });
      } catch (err) {
        if (!cancelled) {
          setGmail({ loading: false, connected: false, email: '', error: err?.message });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!resolved) return;
    const prefTo = initialToKey
      ? initialToKey.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
      : [];
    const validPref = prefTo.filter((e) => options.some((o) => o.email === e));
    setSelected(
      validPref.length
        ? validPref
        : options[0]
          ? [options[0].email]
          : [],
    );
    setSubject(
      initialSubject
        ? String(initialSubject)
        : resolved?.name
          ? `${resolved.name} — Ignite PM`
          : '',
    );
    setBody(String(initialBody || ''));
  }, [resolved?.id, kind, initialSubject, initialBody, initialToKey, options]);

  if (!resolved) return null;

  const toggle = (email) => {
    setSelected((prev) =>
      prev.includes(email) ? prev.filter((e) => e !== email) : [...prev, email],
    );
  };

  const send = async () => {
    if (busy) return;
    if (!gmail.connected) {
      setError('Connect Gmail in Admin → Config before sending.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const payload =
        kind === 'lead'
          ? {
              leadId: resolved.id,
              to: selected,
              subject,
              body,
              ...(inReplyToId ? { inReplyToId } : {}),
            }
          : {
              clientId: resolved.id,
              to: selected,
              subject,
              body,
              ...(inReplyToId ? { inReplyToId } : {}),
            };
      const resp = await authedFetch('/.netlify/functions/send-client-email', payload);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Send failed');
      window.alert(`Email sent to ${selected.join(', ')}.`);
      onClose?.();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const label = kind === 'lead' ? 'lead' : 'client';

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[130] animate-in fade-in">
      <div className="bg-white rounded-[32px] w-full max-w-xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 shrink-0">
          <div>
            <h3 className="font-black text-xl text-slate-900">
              {inReplyToId ? `Reply to ${label}` : `Email ${label}`}
            </h3>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-1">
              {resolved.name || resolved.companyName}
              {gmail.connected && gmail.email ? ` · from ${gmail.email}` : ' · via your Gmail'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 bg-white rounded-full hover:bg-slate-100 border border-slate-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 space-y-4 overflow-y-auto">
          {!gmail.loading && !gmail.connected ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
              Connect your Gmail in Admin → Config before sending email.
            </div>
          ) : null}
          {options.length === 0 ? (
            <p className="text-sm text-slate-500 font-medium">
              No email addresses on this {label} yet. Add a primary contact first.
            </p>
          ) : (
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                To
              </label>
              <div className="space-y-2 max-h-40 overflow-y-auto rounded-2xl border border-slate-200 p-3">
                {options.map((opt) => (
                  <label
                    key={opt.email}
                    className="flex items-center gap-2 text-sm font-bold text-slate-700"
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(opt.email)}
                      onChange={() => toggle(opt.email)}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              Subject
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-[#fd7414]"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              Message
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-medium text-sm outline-none focus:ring-2 focus:ring-[#fd7414] min-h-[160px]"
              placeholder="Write your message…"
            />
          </div>
          {error ? <p className="text-sm font-bold text-red-600">{error}</p> : null}
        </div>
        <div className="p-6 border-t border-slate-100 flex justify-end gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-3 rounded-2xl font-black text-slate-600 bg-white border border-slate-200"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={
              busy ||
              gmail.loading ||
              !gmail.connected ||
              !selected.length ||
              !subject.trim() ||
              !body.trim()
            }
            onClick={send}
            className="px-8 py-3 rounded-2xl font-black bg-black text-white disabled:opacity-40"
          >
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

export { replySubject };

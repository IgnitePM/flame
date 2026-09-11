import React, { useEffect, useMemo, useState } from 'react';
import { Mail, Reply, Search } from 'lucide-react';
import {
  db,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
} from '../firebase';

function formatWhen(ms) {
  const n = Number(ms || 0);
  if (!n) return '';
  try {
    return new Date(n).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function messageMatchesSearch(m, raw) {
  const q = String(raw || '').trim().toLowerCase();
  if (!q) return true;
  const to = Array.isArray(m?.to) ? m.to.join(' ') : String(m?.to || '');
  const hay = [m?.subject, m?.from, to, m?.body, m?.actorEmail]
    .map((v) => String(v || '').toLowerCase())
    .join(' ');
  return hay.includes(q);
}

/**
 * CRM email history for a client or lead (outbound sends + synced inbound).
 * Prefer `entity` + `entityKind`; legacy `client` prop still works.
 */
export default function ClientEmailHistory({
  client,
  entity,
  entityKind = 'client',
  onCompose,
  onReply,
  canCompose = false,
}) {
  const resolved = entity || client;
  const kind = entity ? entityKind : 'client';
  const [messages, setMessages] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!resolved?.id) {
      setMessages([]);
      return undefined;
    }
    const isLead = kind === 'lead';
    const q = query(
      collection(db, 'clientEmailMessages'),
      where(isLead ? 'leadId' : 'clientId', '==', resolved.id),
      orderBy('sentAt', 'desc'),
      limit(50),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setLoadError('');
        setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => {
        console.warn('[ClientEmailHistory]', err);
        setLoadError(
          err?.code === 'failed-precondition'
            ? 'Email history index is still building — try again shortly.'
            : err?.message || 'Could not load emails.',
        );
        setMessages([]);
      },
    );
    return () => unsub();
  }, [resolved?.id, kind]);

  const filtered = useMemo(
    () => messages.filter((m) => messageMatchesSearch(m, search)),
    [messages, search],
  );

  if (!resolved?.id) return null;

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
          Emails ({filtered.length}
          {search.trim() && filtered.length !== messages.length
            ? ` of ${messages.length}`
            : ''}
          )
        </h5>
        {canCompose && onCompose && (
          <button
            type="button"
            onClick={() => onCompose(resolved)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-black text-white text-[10px] font-black uppercase tracking-widest"
          >
            <Mail className="w-3.5 h-3.5" />
            Compose
          </button>
        )}
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search subject, from, to, body…"
          className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-[#fd7414]"
        />
      </div>

      {loadError ? (
        <p className="text-xs font-bold text-amber-700">{loadError}</p>
      ) : null}

      {!loadError && messages.length === 0 ? (
        <p className="text-xs italic text-slate-400">
          No emails yet. Compose from Ignite or sync Gmail (matches CRM emails and website
          domain).
        </p>
      ) : !loadError && filtered.length === 0 ? (
        <p className="text-xs italic text-slate-400">No emails match your search.</p>
      ) : (
        <ul className="space-y-2 max-h-[min(70vh,720px)] overflow-y-auto pr-1">
          {filtered.map((m) => {
            const open = expandedId === m.id;
            const inbound = m.direction === 'inbound';
            return (
              <li
                key={m.id}
                className="rounded-xl border border-slate-200 bg-white overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => setExpandedId(open ? null : m.id)}
                  className="w-full text-left px-3 py-2.5 hover:bg-slate-50"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${
                            inbound
                              ? 'bg-sky-50 text-sky-700'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {inbound ? 'In' : 'Out'}
                        </span>
                        <div className="text-sm font-bold text-slate-800 truncate">
                          {m.subject || '(no subject)'}
                        </div>
                      </div>
                      <div className="text-[10px] font-bold text-slate-400 mt-0.5">
                        {inbound
                          ? `From ${m.from || m.actorEmail || (kind === 'lead' ? 'lead' : 'client')}`
                          : `To ${(m.to || []).join(', ')} · ${m.actorEmail || 'staff'}`}
                      </div>
                    </div>
                    <span className="text-[10px] font-bold text-slate-400 shrink-0">
                      {formatWhen(m.sentAt)}
                    </span>
                  </div>
                </button>
                {open && (
                  <div className="px-3 pb-3 space-y-2 border-t border-slate-100 pt-2">
                    <pre className="text-xs font-medium text-slate-600 whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-sans max-h-[min(50vh,480px)] overflow-y-auto">
                      {m.body || ''}
                    </pre>
                    {canCompose && onReply && (
                      <button
                        type="button"
                        onClick={() => onReply(m)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-700 hover:bg-slate-50"
                      >
                        <Reply className="w-3.5 h-3.5" />
                        Reply
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { Mail, Reply } from 'lucide-react';
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

/**
 * CRM outbound email history for a client (full message bodies).
 */
export default function ClientEmailHistory({
  client,
  onCompose,
  onReply,
  canCompose = false,
}) {
  const [messages, setMessages] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!client?.id) {
      setMessages([]);
      return undefined;
    }
    const q = query(
      collection(db, 'clientEmailMessages'),
      where('clientId', '==', client.id),
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
  }, [client?.id]);

  if (!client?.id) return null;

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
          Emails ({messages.length})
        </h5>
        {canCompose && onCompose && (
          <button
            type="button"
            onClick={() => onCompose(client)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-black text-white text-[10px] font-black uppercase tracking-widest"
          >
            <Mail className="w-3.5 h-3.5" />
            Compose
          </button>
        )}
      </div>

      {loadError ? (
        <p className="text-xs font-bold text-amber-700">{loadError}</p>
      ) : null}

      {!loadError && messages.length === 0 ? (
        <p className="text-xs italic text-slate-400">
          No emails sent from Ignite yet. Compose to log a full send history here.
        </p>
      ) : (
        <ul className="space-y-2 max-h-[360px] overflow-y-auto">
          {messages.map((m) => {
            const open = expandedId === m.id;
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
                      <div className="text-sm font-bold text-slate-800 truncate">
                        {m.subject || '(no subject)'}
                      </div>
                      <div className="text-[10px] font-bold text-slate-400 mt-0.5">
                        To {(m.to || []).join(', ')} · {m.actorEmail || 'staff'}
                      </div>
                    </div>
                    <span className="text-[10px] font-bold text-slate-400 shrink-0">
                      {formatWhen(m.sentAt)}
                    </span>
                  </div>
                </button>
                {open && (
                  <div className="px-3 pb-3 space-y-2 border-t border-slate-100 pt-2">
                    <pre className="text-xs font-medium text-slate-600 whitespace-pre-wrap font-sans max-h-48 overflow-y-auto">
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

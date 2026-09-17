import React, { useEffect, useState } from 'react';
import { MessageSquareWarning } from 'lucide-react';
import {
  db,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  limit,
  doc,
  updateDoc,
} from '../firebase.js';
import { safeDisplayForReact } from '../utils/safeReactText.js';

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
 * Staff view of portal feedback / bug reports for one client.
 */
export default function PortalFeedbackPanel({ client }) {
  const clientId = client?.id;
  const [items, setItems] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    if (!clientId) {
      setItems([]);
      return undefined;
    }
    const q = query(
      collection(db, 'clientPortalFeedback'),
      where('clientId', '==', clientId),
      orderBy('createdAt', 'desc'),
      limit(50),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setLoadError('');
        setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => {
        setLoadError(err?.message || 'Could not load feedback.');
        setItems([]);
      },
    );
    return () => unsub();
  }, [clientId]);

  const setStatus = async (item, status) => {
    if (!item?.id || busyId) return;
    setBusyId(item.id);
    try {
      await updateDoc(doc(db, 'clientPortalFeedback', item.id), {
        status,
        updatedAt: Date.now(),
      });
    } catch (err) {
      window.alert(err?.message || 'Could not update status.');
    } finally {
      setBusyId('');
    }
  };

  if (!clientId) return null;

  return (
    <div className="space-y-4">
      <div>
        <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
          <MessageSquareWarning className="w-3.5 h-3.5" />
          Portal feedback
        </h5>
        <p className="text-xs font-medium text-slate-500 mt-1">
          Feedback and bug reports submitted from this client&apos;s portal.
        </p>
      </div>
      {loadError ? (
        <p className="text-xs font-bold text-amber-700">{loadError}</p>
      ) : null}
      {items.length === 0 && !loadError ? (
        <p className="text-xs italic text-slate-400 bg-slate-50 border border-slate-200 rounded-2xl p-6 text-center">
          No portal feedback yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const isBug = item.type === 'bug';
            return (
              <li
                key={item.id}
                className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md ${
                      isBug
                        ? 'bg-rose-50 text-rose-700 border border-rose-100'
                        : 'bg-sky-50 text-sky-700 border border-sky-100'
                    }`}
                  >
                    {isBug ? 'Bug' : 'Feedback'}
                  </span>
                  <span
                    className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border ${
                      item.status === 'closed'
                        ? 'bg-slate-100 text-slate-500 border-slate-200'
                        : item.status === 'triaged'
                          ? 'bg-amber-50 text-amber-800 border-amber-100'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-100'
                    }`}
                  >
                    {item.status || 'new'}
                  </span>
                  <span className="text-[10px] font-bold text-slate-400">
                    {formatWhen(item.createdAt)}
                    {item.createdByEmail ? ` · ${item.createdByEmail}` : ''}
                  </span>
                </div>
                {item.subject ? (
                  <h6 className="text-sm font-black text-slate-800">
                    {safeDisplayForReact(item.subject)}
                  </h6>
                ) : null}
                <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">
                  {safeDisplayForReact(item.body)}
                </p>
                {(item.portalSection || item.pageUrl) && (
                  <p className="text-[10px] font-bold text-slate-400 break-all">
                    {item.portalSection ? `Section: ${item.portalSection}` : ''}
                    {item.portalSection && item.pageUrl ? ' · ' : ''}
                    {item.pageUrl || ''}
                  </p>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  {item.status !== 'triaged' ? (
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => setStatus(item, 'triaged')}
                      className="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest bg-amber-50 text-amber-800 hover:bg-amber-100 disabled:opacity-40"
                    >
                      Mark triaged
                    </button>
                  ) : null}
                  {item.status !== 'closed' ? (
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => setStatus(item, 'closed')}
                      className="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-40"
                    >
                      Close
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => setStatus(item, 'new')}
                      className="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-40"
                    >
                      Reopen
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

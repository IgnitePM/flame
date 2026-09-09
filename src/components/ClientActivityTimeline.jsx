import React, { useEffect, useMemo, useState } from 'react';
import {
  ACTIVITY_FILTER_GROUPS,
  MANUAL_ACTIVITY_TYPES,
  activityMatchesFilter,
  activityTypeLabel,
  formatActivityWhen,
} from '../utils/clientActivity.js';
import { db, collection, query, where, orderBy, onSnapshot, limit } from '../firebase';

/**
 * HubSpot-style per-client activity feed (manual notes + system events).
 */
export default function ClientActivityTimeline({
  client,
  logClientActivity,
  canCompose = true,
}) {
  const [activities, setActivities] = useState([]);
  const [filter, setFilter] = useState('all');
  const [composeType, setComposeType] = useState('note');
  const [composeTitle, setComposeTitle] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!client?.id) {
      setActivities([]);
      return undefined;
    }
    const q = query(
      collection(db, 'clientActivities'),
      where('clientId', '==', client.id),
      orderBy('at', 'desc'),
      limit(100),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setLoadError('');
        setActivities(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => {
        console.warn('[ClientActivityTimeline]', err);
        setLoadError(
          err?.code === 'failed-precondition'
            ? 'Activity index is still building — try again in a minute.'
            : err?.message || 'Could not load activity.',
        );
        setActivities([]);
      },
    );
    return () => unsub();
  }, [client?.id]);

  const filtered = useMemo(
    () => activities.filter((a) => activityMatchesFilter(a, filter)),
    [activities, filter],
  );

  const submit = async () => {
    if (!client?.id || !logClientActivity || saving) return;
    const title = composeTitle.trim() || activityTypeLabel(composeType);
    setSaving(true);
    try {
      await logClientActivity({
        clientId: client.id,
        clientName: client.name || '',
        type: composeType,
        title,
        body: composeBody.trim(),
        source: 'manual',
      });
      setComposeTitle('');
      setComposeBody('');
    } catch (err) {
      window.alert(err?.message || 'Could not save activity.');
    } finally {
      setSaving(false);
    }
  };

  if (!client?.id) return null;

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
          Activity
        </h5>
        <div className="flex flex-wrap gap-1.5">
          {ACTIVITY_FILTER_GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setFilter(g.id)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest ${
                filter === g.id
                  ? 'bg-black text-white'
                  : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-100'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {canCompose && logClientActivity && (
        <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
          <div className="grid gap-2 sm:grid-cols-[140px_1fr]">
            <select
              value={composeType}
              onChange={(e) => setComposeType(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-[#fd7414]"
            >
              {MANUAL_ACTIVITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {activityTypeLabel(t)}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={composeTitle}
              onChange={(e) => setComposeTitle(e.target.value)}
              placeholder="Title (optional)"
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-[#fd7414]"
            />
          </div>
          <textarea
            value={composeBody}
            onChange={(e) => setComposeBody(e.target.value)}
            placeholder="Log a note, call, or meeting…"
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-2 focus:ring-[#fd7414] min-h-[72px]"
          />
          <div className="flex justify-end">
            <button
              type="button"
              disabled={saving || (!composeTitle.trim() && !composeBody.trim())}
              onClick={submit}
              className="px-4 py-2 rounded-xl bg-black text-white text-[10px] font-black uppercase tracking-widest disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Log activity'}
            </button>
          </div>
        </div>
      )}

      {loadError ? (
        <p className="text-xs font-bold text-amber-700">{loadError}</p>
      ) : null}

      {filtered.length === 0 && !loadError ? (
        <p className="text-xs italic text-slate-400">
          No activity yet — log a call or send an email.
        </p>
      ) : (
        <ul className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
          {filtered.map((a) => (
            <li
              key={a.id}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 space-y-1"
            >
              <div className="flex flex-wrap items-center gap-2 justify-between">
                <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-slate-600">
                  {activityTypeLabel(a.type)}
                </span>
                <span className="text-[10px] font-bold text-slate-400">
                  {formatActivityWhen(a.at)}
                </span>
              </div>
              <div className="text-sm font-bold text-slate-800">{a.title}</div>
              {a.body ? (
                <p className="text-xs font-medium text-slate-500 whitespace-pre-wrap">
                  {a.body}
                </p>
              ) : null}
              <div className="text-[10px] font-bold text-slate-400">
                {a.actorEmail || 'system'}
                {a.source === 'manual' ? ' · logged' : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

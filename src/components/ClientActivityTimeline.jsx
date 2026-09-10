import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, FileText } from 'lucide-react';
import {
  ACTIVITY_FILTER_GROUPS,
  MANUAL_ACTIVITY_TYPES,
  activityIsCollapsible,
  activityMatchesFilter,
  activityTypeLabel,
  formatActivityWhen,
} from '../utils/clientActivity.js';
import { db, collection, query, where, orderBy, onSnapshot, limit } from '../firebase';

function ActivityRow({ activity: a }) {
  const collapsible = activityIsCollapsible(a.type);
  const hasBody = Boolean(String(a.body || '').trim());
  const transcriptUrl =
    a.meta?.transcriptUrl || a.meta?.googleDocUrl || a.meta?.docUrl || '';
  const [open, setOpen] = useState(false);

  const preview =
    hasBody && !open && collapsible
      ? `${String(a.body).replace(/\s+/g, ' ').trim().slice(0, 120)}${
          String(a.body).trim().length > 120 ? '…' : ''
        }`
      : null;

  return (
    <li className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 space-y-1">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-slate-600">
          {activityTypeLabel(a.type)}
        </span>
        <span className="text-[10px] font-bold text-slate-400">
          {formatActivityWhen(a.at)}
        </span>
      </div>
      <div className="flex items-start gap-1.5">
        {collapsible && (hasBody || transcriptUrl) ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-0.5 p-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-50"
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            {open ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-slate-800">{a.title}</div>
          {preview && !open ? (
            <p className="text-xs font-medium text-slate-400 mt-0.5">{preview}</p>
          ) : null}
          {hasBody && (!collapsible || open) ? (
            <p className="text-xs font-medium text-slate-500 whitespace-pre-wrap mt-1">
              {a.body}
            </p>
          ) : null}
          {open && transcriptUrl ? (
            <a
              href={transcriptUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-2 text-[10px] font-black uppercase tracking-widest text-[#fd7414] hover:underline"
            >
              <FileText className="w-3 h-3" />
              Meeting transcript
              <ExternalLink className="w-3 h-3" />
            </a>
          ) : null}
          {!open && collapsible && transcriptUrl ? (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex items-center gap-1 mt-1 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-[#fd7414]"
            >
              <FileText className="w-3 h-3" />
              Transcript available
            </button>
          ) : null}
        </div>
      </div>
      <div className="text-[10px] font-bold text-slate-400">
        {a.actorEmail || 'system'}
        {a.source === 'manual' ? ' · logged' : ''}
      </div>
    </li>
  );
}

/**
 * HubSpot-style activity feed for a client or lead.
 * Prefer `entity` + `entityKind` + `logActivity`; legacy `client` + `logClientActivity` still work.
 */
export default function ClientActivityTimeline({
  client,
  entity,
  entityKind = 'client',
  logClientActivity,
  logActivity,
  canCompose = true,
}) {
  const resolved = entity || client;
  const kind = entity ? entityKind : 'client';
  const logger = logActivity || logClientActivity;
  const [activities, setActivities] = useState([]);
  const [filter, setFilter] = useState('all');
  const [composeType, setComposeType] = useState('note');
  const [composeTitle, setComposeTitle] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeTranscriptUrl, setComposeTranscriptUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!resolved?.id) {
      setActivities([]);
      return undefined;
    }
    const isLead = kind === 'lead';
    const q = query(
      collection(db, isLead ? 'leadActivities' : 'clientActivities'),
      where(isLead ? 'leadId' : 'clientId', '==', resolved.id),
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
  }, [resolved?.id, kind]);

  const filtered = useMemo(
    () => activities.filter((a) => activityMatchesFilter(a, filter)),
    [activities, filter],
  );

  const submit = async () => {
    if (!resolved?.id || !logger || saving) return;
    const title = composeTitle.trim() || activityTypeLabel(composeType);
    setSaving(true);
    try {
      const transcript = String(composeTranscriptUrl || '').trim();
      const meta =
        composeType === 'meeting' && transcript
          ? { transcriptUrl: transcript, googleDocUrl: transcript }
          : {};
      if (kind === 'lead') {
        await logger({
          leadId: resolved.id,
          leadName: resolved.name || resolved.companyName || '',
          type: composeType,
          title,
          body: composeBody.trim(),
          source: 'manual',
          meta,
        });
      } else {
        await logger({
          clientId: resolved.id,
          clientName: resolved.name || '',
          type: composeType,
          title,
          body: composeBody.trim(),
          source: 'manual',
          meta,
        });
      }
      setComposeTitle('');
      setComposeBody('');
      setComposeTranscriptUrl('');
    } catch (err) {
      window.alert(err?.message || 'Could not save activity.');
    } finally {
      setSaving(false);
    }
  };

  if (!resolved?.id) return null;

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

      {canCompose && logger && (
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
            placeholder={
              composeType === 'tag'
                ? 'Tag note (e.g. VIP, renewal risk)…'
                : composeType === 'meeting'
                  ? 'Meeting notes…'
                  : 'Log a note, call, or meeting…'
            }
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-2 focus:ring-[#fd7414] min-h-[72px]"
          />
          {composeType === 'meeting' ? (
            <input
              type="url"
              value={composeTranscriptUrl}
              onChange={(e) => setComposeTranscriptUrl(e.target.value)}
              placeholder="Transcript Google Doc URL (optional)"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-2 focus:ring-[#fd7414]"
            />
          ) : null}
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
            <ActivityRow key={a.id} activity={a} />
          ))}
        </ul>
      )}
    </div>
  );
}

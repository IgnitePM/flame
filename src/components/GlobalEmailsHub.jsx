import React, { useEffect, useMemo, useState } from 'react';
import { Mail, Search } from 'lucide-react';
import {
  db,
  collection,
  query,
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
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function withinRange(ms, fromMs, toMs) {
  const n = Number(ms || 0);
  if (!n) return false;
  if (fromMs && n < fromMs) return false;
  if (toMs && n > toMs) return false;
  return true;
}

/**
 * Staff-wide Emails inbox across clients (and leads when present).
 */
export default function GlobalEmailsHub({
  clients = [],
  leads = [],
  onOpenClient,
  onOpenLead,
}) {
  const [rows, setRows] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [clientId, setClientId] = useState('');
  const [sortDir, setSortDir] = useState('newest');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const nameByClientId = useMemo(() => {
    const map = new Map();
    for (const c of clients || []) map.set(c.id, c.name || c.id);
    return map;
  }, [clients]);

  const nameByLeadId = useMemo(() => {
    const map = new Map();
    for (const l of leads || []) map.set(l.id, l.name || l.companyName || l.id);
    return map;
  }, [leads]);

  useEffect(() => {
    const q = query(
      collection(db, 'clientEmailMessages'),
      orderBy('sentAt', 'desc'),
      limit(300),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setLoadError('');
        setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => {
        console.warn('[GlobalEmailsHub]', err);
        setLoadError(
          err?.code === 'failed-precondition'
            ? 'Email index is still building — try again shortly.'
            : err?.message || 'Could not load emails.',
        );
        setRows([]);
      },
    );
    return () => unsub();
  }, []);

  const fromMs = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : 0;
  const toMs = toDate ? new Date(`${toDate}T23:59:59`).getTime() : 0;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rows.filter((m) => {
      if (clientId) {
        if (m.clientId !== clientId && m.leadId !== clientId) return false;
      }
      if (!withinRange(m.sentAt, fromMs, toMs)) return false;
      if (!q) return true;
      const name =
        nameByClientId.get(m.clientId) || nameByLeadId.get(m.leadId) || '';
      const to = Array.isArray(m.to) ? m.to.join(' ') : String(m.to || '');
      const hay = [m.subject, m.from, to, m.body, m.actorEmail, name]
        .map((v) => String(v || '').toLowerCase())
        .join(' ');
      return hay.includes(q);
    });
    list = [...list].sort((a, b) =>
      sortDir === 'oldest'
        ? Number(a.sentAt || 0) - Number(b.sentAt || 0)
        : Number(b.sentAt || 0) - Number(a.sentAt || 0),
    );
    return list;
  }, [
    rows,
    search,
    clientId,
    sortDir,
    fromMs,
    toMs,
    nameByClientId,
    nameByLeadId,
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
          <Mail className="w-6 h-6 text-[#fd7414]" />
          Emails
        </h2>
        <p className="text-xs font-bold text-slate-400 mt-1">
          All client & lead email history · {filtered.length} shown
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <label className="sm:col-span-2 space-y-1">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            Search
          </span>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Subject, from, body, client…"
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm font-medium outline-none focus:ring-2 focus:ring-[#fd7414]"
            />
          </div>
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            Client
          </span>
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="w-full py-2 px-3 rounded-xl border border-slate-200 bg-slate-50 text-sm font-bold outline-none"
          >
            <option value="">All clients</option>
            {[...(clients || [])]
              .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            Sort
          </span>
          <select
            value={sortDir}
            onChange={(e) => setSortDir(e.target.value)}
            className="w-full py-2 px-3 rounded-xl border border-slate-200 bg-slate-50 text-sm font-bold outline-none"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            From date
          </span>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="w-full py-2 px-3 rounded-xl border border-slate-200 bg-slate-50 text-sm font-bold outline-none"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            To date
          </span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="w-full py-2 px-3 rounded-xl border border-slate-200 bg-slate-50 text-sm font-bold outline-none"
          />
        </label>
      </div>

      {loadError ? (
        <p className="text-xs font-bold text-amber-700">{loadError}</p>
      ) : null}

      <ul className="space-y-2">
        {filtered.length === 0 && !loadError ? (
          <li className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-400 italic">
            No emails match these filters.
          </li>
        ) : (
          filtered.map((m) => {
            const label = m.clientId
              ? nameByClientId.get(m.clientId) || 'Client'
              : nameByLeadId.get(m.leadId) || 'Lead';
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (m.clientId) onOpenClient?.(m.clientId, 'emails');
                    else if (m.leadId) onOpenLead?.(m.leadId);
                  }}
                  className="w-full text-left bg-white border border-slate-200 hover:border-[#fd7414]/40 rounded-2xl p-4 transition-colors"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-black text-slate-800">{label}</div>
                    <div className="text-[10px] font-bold text-slate-400">
                      {formatWhen(m.sentAt)} · {m.direction || m.kind || 'email'}
                    </div>
                  </div>
                  <div className="text-sm font-bold text-slate-700 mt-1">
                    {m.subject || '(no subject)'}
                  </div>
                  <div className="text-[10px] font-bold text-slate-400 mt-0.5">
                    {m.from || m.actorEmail || ''}
                  </div>
                  {m.body ? (
                    <p className="text-sm font-medium text-slate-500 mt-2 line-clamp-2">
                      {m.body}
                    </p>
                  ) : null}
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

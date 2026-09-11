import React, { useEffect, useMemo, useState } from 'react';
import { Mail, MessageSquare, Search } from 'lucide-react';
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
 * Staff-wide Messages inbox across clients.
 */
export default function GlobalMessagesHub({
  clients = [],
  onOpenClient,
}) {
  const [rows, setRows] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [clientId, setClientId] = useState('');
  const [authorType, setAuthorType] = useState('all');
  const [sortDir, setSortDir] = useState('newest');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const clientNameById = useMemo(() => {
    const map = new Map();
    for (const c of clients || []) map.set(c.id, c.name || c.id);
    return map;
  }, [clients]);

  useEffect(() => {
    const q = query(
      collection(db, 'clientMessages'),
      orderBy('createdAt', 'desc'),
      limit(300),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setLoadError('');
        setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => {
        console.warn('[GlobalMessagesHub]', err);
        setLoadError(
          err?.code === 'failed-precondition'
            ? 'Messages index is still building — try again shortly.'
            : err?.message || 'Could not load messages.',
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
      if (clientId && m.clientId !== clientId) return false;
      if (authorType !== 'all' && m.authorType !== authorType) return false;
      if (!withinRange(m.createdAt, fromMs, toMs)) return false;
      if (!q) return true;
      const name = clientNameById.get(m.clientId) || '';
      const hay = [m.body, m.authorName, m.authorEmail, name]
        .map((v) => String(v || '').toLowerCase())
        .join(' ');
      return hay.includes(q);
    });
    list = [...list].sort((a, b) =>
      sortDir === 'oldest'
        ? Number(a.createdAt || 0) - Number(b.createdAt || 0)
        : Number(b.createdAt || 0) - Number(a.createdAt || 0),
    );
    return list;
  }, [
    rows,
    search,
    clientId,
    authorType,
    sortDir,
    fromMs,
    toMs,
    clientNameById,
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <MessageSquare className="w-6 h-6 text-[#fd7414]" />
            Messages
          </h2>
          <p className="text-xs font-bold text-slate-400 mt-1">
            All client portal conversations · {filtered.length} shown
          </p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
        <label className="sm:col-span-2 space-y-1">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            Search
          </span>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Body, author, client…"
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
            From
          </span>
          <select
            value={authorType}
            onChange={(e) => setAuthorType(e.target.value)}
            className="w-full py-2 px-3 rounded-xl border border-slate-200 bg-slate-50 text-sm font-bold outline-none"
          >
            <option value="all">Staff + client</option>
            <option value="staff">Staff only</option>
            <option value="client">Client only</option>
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
            No messages match these filters.
          </li>
        ) : (
          filtered.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onOpenClient?.(m.clientId, 'messages')}
                className="w-full text-left bg-white border border-slate-200 hover:border-[#fd7414]/40 rounded-2xl p-4 transition-colors"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-black text-slate-800">
                    {clientNameById.get(m.clientId) || m.clientId || 'Client'}
                  </div>
                  <div className="text-[10px] font-bold text-slate-400">
                    {formatWhen(m.createdAt)} · {m.authorType === 'client' ? 'Client' : 'Staff'}
                  </div>
                </div>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-1">
                  {m.authorName || m.authorEmail || 'Unknown'}
                </div>
                <p className="text-sm font-medium text-slate-600 mt-2 line-clamp-2 whitespace-pre-wrap">
                  {m.body}
                </p>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { Megaphone, Plus, Pencil, X } from 'lucide-react';
import {
  db,
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
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

function emptyForm() {
  return {
    title: '',
    body: '',
    ctaLabel: '',
    ctaUrl: '',
    active: true,
    allClients: true,
    clientIds: [],
  };
}

/**
 * Staff compose / manage portal Home announcements (all clients or selected).
 */
export default function PortalAnnouncementsPanel({ clients = [], userEmail = '' }) {
  const [rows, setRows] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const sortedClients = useMemo(
    () =>
      [...(clients || [])].sort((a, b) =>
        String(a.name || '').localeCompare(String(b.name || '')),
      ),
    [clients],
  );

  const clientNameById = useMemo(() => {
    const map = new Map();
    for (const c of clients || []) map.set(c.id, c.name || c.id);
    return map;
  }, [clients]);

  useEffect(() => {
    const q = query(
      collection(db, 'portalAnnouncements'),
      orderBy('createdAt', 'desc'),
      limit(100),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setLoadError('');
        setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => {
        console.warn('[PortalAnnouncementsPanel]', err);
        setLoadError(
          err?.code === 'failed-precondition'
            ? 'Announcements index is still building — try again shortly.'
            : err?.message || 'Could not load announcements.',
        );
        setRows([]);
      },
    );
    return () => unsub();
  }, []);

  const startEdit = (row) => {
    const ids = Array.isArray(row.clientIds) ? row.clientIds.filter(Boolean) : [];
    setEditingId(row.id);
    setForm({
      title: String(row.title || ''),
      body: String(row.body || ''),
      ctaLabel: String(row.ctaLabel || ''),
      ctaUrl: String(row.ctaUrl || ''),
      active: row.active !== false,
      allClients: ids.length === 0,
      clientIds: ids,
    });
    setStatus('');
  };

  const cancelEdit = () => {
    setEditingId('');
    setForm(emptyForm());
    setStatus('');
  };

  const toggleClient = (id) => {
    setForm((prev) => {
      const has = prev.clientIds.includes(id);
      return {
        ...prev,
        clientIds: has
          ? prev.clientIds.filter((x) => x !== id)
          : [...prev.clientIds, id],
      };
    });
  };

  const save = async (e) => {
    e?.preventDefault?.();
    const title = form.title.trim();
    const body = form.body.trim();
    if (!title || !body) {
      setStatus('Title and message are required.');
      return;
    }
    if (!form.allClients && form.clientIds.length === 0) {
      setStatus('Select at least one client, or choose All clients.');
      return;
    }
    const ctaUrl = form.ctaUrl.trim();
    if (ctaUrl && !/^https?:\/\//i.test(ctaUrl)) {
      setStatus('CTA link must start with http:// or https://');
      return;
    }

    setBusy(true);
    setStatus('');
    const payload = {
      title,
      body,
      ctaLabel: form.ctaLabel.trim(),
      ctaUrl,
      active: Boolean(form.active),
      clientIds: form.allClients ? [] : form.clientIds,
      updatedAt: Date.now(),
    };

    try {
      if (editingId) {
        await updateDoc(doc(db, 'portalAnnouncements', editingId), payload);
        setStatus('Announcement updated.');
      } else {
        await addDoc(collection(db, 'portalAnnouncements'), {
          ...payload,
          createdAt: Date.now(),
          createdByEmail: String(userEmail || '').trim().toLowerCase(),
        });
        setStatus('Announcement published.');
      }
      cancelEdit();
    } catch (err) {
      setStatus(err?.message || 'Could not save announcement.');
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (row, active) => {
    if (!row?.id || busy) return;
    setBusy(true);
    try {
      await updateDoc(doc(db, 'portalAnnouncements', row.id), {
        active: Boolean(active),
        updatedAt: Date.now(),
      });
    } catch (err) {
      window.alert(err?.message || 'Could not update status.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
          <Megaphone className="w-6 h-6 text-[#fd7414]" />
          Portal announcements
        </h2>
        <p className="text-xs font-bold text-slate-400 mt-1">
          Posts appear on every matching client&apos;s portal Home. Clients can dismiss
          them.
        </p>
      </div>

      <form
        onSubmit={save}
        className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3"
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            {editingId ? 'Edit announcement' : 'New announcement'}
          </h3>
          {editingId ? (
            <button
              type="button"
              onClick={cancelEdit}
              className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-700 inline-flex items-center gap-1"
            >
              <X className="w-3.5 h-3.5" />
              Cancel
            </button>
          ) : null}
        </div>

        <label className="block space-y-1">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            Title
          </span>
          <input
            value={form.title}
            onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
            placeholder="Ignite now offers in-house Google Ads"
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm font-bold outline-none focus:ring-2 focus:ring-[#fd7414]"
            maxLength={120}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            Message
          </span>
          <textarea
            value={form.body}
            onChange={(e) => setForm((p) => ({ ...p, body: e.target.value }))}
            placeholder="Tell clients what’s new and how to get started…"
            rows={4}
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm font-medium outline-none focus:ring-2 focus:ring-[#fd7414] resize-y min-h-[96px]"
            maxLength={2000}
          />
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Button label (optional)
            </span>
            <input
              value={form.ctaLabel}
              onChange={(e) => setForm((p) => ({ ...p, ctaLabel: e.target.value }))}
              placeholder="Learn more"
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm font-bold outline-none focus:ring-2 focus:ring-[#fd7414]"
              maxLength={40}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Button link (optional)
            </span>
            <input
              value={form.ctaUrl}
              onChange={(e) => setForm((p) => ({ ...p, ctaUrl: e.target.value }))}
              placeholder="https://…"
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm font-medium outline-none focus:ring-2 focus:ring-[#fd7414]"
              maxLength={500}
            />
          </label>
        </div>

        <div className="space-y-2">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            Audience
          </span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setForm((p) => ({ ...p, allClients: true, clientIds: [] }))}
              className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-colors ${
                form.allClients
                  ? 'bg-[#fd7414] text-white border-[#fd7414]'
                  : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
              }`}
            >
              All clients
            </button>
            <button
              type="button"
              onClick={() => setForm((p) => ({ ...p, allClients: false }))}
              className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-colors ${
                !form.allClients
                  ? 'bg-[#fd7414] text-white border-[#fd7414]'
                  : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
              }`}
            >
              Selected clients
            </button>
          </div>
          {!form.allClients ? (
            <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-xl p-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
              {sortedClients.map((c) => {
                const checked = form.clientIds.includes(c.id);
                return (
                  <label
                    key={c.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleClient(c.id)}
                      className="rounded border-slate-300 text-[#fd7414] focus:ring-[#fd7414]"
                    />
                    <span className="text-xs font-bold text-slate-700 truncate">
                      {c.name || c.id}
                    </span>
                  </label>
                );
              })}
            </div>
          ) : null}
        </div>

        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm((p) => ({ ...p, active: e.target.checked }))}
            className="rounded border-slate-300 text-[#fd7414] focus:ring-[#fd7414]"
          />
          <span className="text-xs font-bold text-slate-600">Active (visible in portal)</span>
        </label>

        {status ? (
          <p className="text-xs font-bold text-slate-600">{status}</p>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-2 bg-[#fd7414] hover:bg-[#e8680f] disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-colors"
        >
          {editingId ? (
            <>
              <Pencil className="w-3.5 h-3.5" />
              Save changes
            </>
          ) : (
            <>
              <Plus className="w-3.5 h-3.5" />
              Publish
            </>
          )}
        </button>
      </form>

      {loadError ? (
        <p className="text-xs font-bold text-amber-700">{loadError}</p>
      ) : null}

      <ul className="space-y-3">
        {rows.length === 0 && !loadError ? (
          <li className="text-xs italic text-slate-400 bg-white border border-slate-200 rounded-2xl p-6 text-center">
            No announcements yet.
          </li>
        ) : null}
        {rows.map((row) => {
          const ids = Array.isArray(row.clientIds) ? row.clientIds.filter(Boolean) : [];
          const audience =
            ids.length === 0
              ? 'All clients'
              : ids.map((id) => clientNameById.get(id) || id).join(', ');
          const isActive = row.active !== false;
          return (
            <li
              key={row.id}
              className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span
                      className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border ${
                        isActive
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                          : 'bg-slate-50 text-slate-500 border-slate-200'
                      }`}
                    >
                      {isActive ? 'Active' : 'Inactive'}
                    </span>
                    <span className="text-[10px] font-bold text-slate-400">
                      {formatWhen(row.createdAt)}
                      {row.createdByEmail
                        ? ` · ${safeDisplayForReact(row.createdByEmail)}`
                        : ''}
                    </span>
                  </div>
                  <h4 className="font-black text-slate-900 text-sm">
                    {safeDisplayForReact(row.title)}
                  </h4>
                  <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap">
                    {safeDisplayForReact(row.body)}
                  </p>
                  <p className="text-[10px] font-bold text-slate-400 mt-2 uppercase tracking-widest">
                    {audience}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => startEdit(row)}
                    className="px-3 py-1.5 rounded-xl border border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setActive(row, !isActive)}
                    className="px-3 py-1.5 rounded-xl border border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {isActive ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

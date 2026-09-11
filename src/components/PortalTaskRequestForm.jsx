import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { authedFetch } from '../utils/authedFetch.js';

/**
 * Portal form to request a retainer-category task (staff must approve).
 * Estimated hours are assigned by staff after review — not by the client.
 */
export default function PortalTaskRequestForm({
  client,
  categories = [],
  todoCategoryKey,
}) {
  const categoryOptions = [
    ...categories,
    ...(categories.includes('General / Unclassified')
      ? []
      : ['General / Unclassified']),
  ];
  const [categoryLabel, setCategoryLabel] = useState(
    categoryOptions[0] || 'General / Unclassified',
  );
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState('');

  const submit = async () => {
    if (!client?.id || !text.trim() || busy) return;
    setBusy(true);
    setBanner('');
    try {
      const resp = await authedFetch('/.netlify/functions/client-todo-request', {
        clientId: client.id,
        categoryLabel,
        categoryKey: todoCategoryKey ? todoCategoryKey(categoryLabel) : undefined,
        text: text.trim(),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Could not submit request');
      setText('');
      setBanner('Request sent — Ignite will review it shortly.');
    } catch (err) {
      setBanner(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-4 space-y-3">
      <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
        Request a task
      </div>
      <select
        value={categoryLabel}
        onChange={(e) => setCategoryLabel(e.target.value)}
        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-[#fd7414]"
      >
        {categoryOptions.map((cat) => (
          <option key={cat} value={cat}>
            {cat}
          </option>
        ))}
      </select>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="What should we work on?"
        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-2 focus:ring-[#fd7414]"
      />
      <button
        type="button"
        disabled={busy || !text.trim()}
        onClick={submit}
        className="inline-flex items-center gap-2 rounded-xl bg-[#fd7414] px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40"
      >
        <Plus className="w-3.5 h-3.5" />
        {busy ? 'Sending…' : 'Submit for approval'}
      </button>
      {banner ? <p className="text-xs font-bold text-slate-600">{banner}</p> : null}
    </div>
  );
}

import React, { useMemo, useState } from 'react';
import { authedFetch } from '../utils/authedFetch.js';
import { isTodoAwaitingClientApproval } from '../utils/todoApproval.js';
import { formatReviewDeadlineLabel } from '../utils/todoUrgency.js';
import { TextWithLinks } from '../utils/textWithLinks.jsx';

/**
 * Client portal: retainer tasks awaiting client approval (not Planable / deliverable reviews).
 */
export default function PortalTaskApprovalsPanel({
  client,
  todoState = {},
  cycleStart,
  labelForCategoryKey,
}) {
  const [busyId, setBusyId] = useState('');
  const [notes, setNotes] = useState({});
  const [error, setError] = useState('');
  const [banner, setBanner] = useState('');

  const pending = useMemo(() => {
    const rows = [];
    for (const [categoryKey, catTodo] of Object.entries(todoState || {})) {
      for (const item of catTodo?.items || []) {
        if (!isTodoAwaitingClientApproval(item)) continue;
        rows.push({ categoryKey, item });
      }
    }
    rows.sort(
      (a, b) =>
        Number(b.item?.approvalRequestedAt || 0) -
        Number(a.item?.approvalRequestedAt || 0),
    );
    return rows;
  }, [todoState]);

  const decide = async (row, decision) => {
    if (!client?.id || !row?.item?.id || busyId) return;
    setBusyId(row.item.id);
    setError('');
    setBanner('');
    try {
      const resp = await authedFetch('/.netlify/functions/client-todo-approval-decide', {
        clientId: client.id,
        cycleStart,
        categoryKey: row.categoryKey,
        itemId: row.item.id,
        decision,
        note: notes[row.item.id] || '',
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Could not save your decision.');
      setBanner(
        decision === 'approved'
          ? 'Task approved — marked complete.'
          : 'Revision request sent to Ignite.',
      );
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusyId('');
    }
  };

  if (!pending.length) {
    return (
      <div className="bg-white p-6 sm:p-8 rounded-[32px] border border-slate-100 shadow-sm">
        <h3 className="font-black text-lg text-slate-900">Retainer tasks</h3>
        <p className="text-sm text-slate-500 font-medium mt-2">
          Nothing waiting on you right now. When Ignite marks a cycle task ready for your
          review, it will show up here. Social Media creative is still approved in Planable.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 sm:p-8 rounded-[32px] border border-slate-100 shadow-sm space-y-5">
      <div>
        <h3 className="font-black text-lg text-slate-900">Retainer tasks</h3>
        <p className="text-sm text-slate-500 font-medium mt-1">
          Approve to mark the task complete, or request revisions. Social Media creative
          stays in Planable.
        </p>
      </div>
      {banner ? (
        <p className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2">
          {banner}
        </p>
      ) : null}
      {error ? (
        <p className="text-xs font-bold text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
          {error}
        </p>
      ) : null}
      <ul className="space-y-4">
        {pending.map((row) => {
          const label =
            (typeof labelForCategoryKey === 'function' &&
              labelForCategoryKey(row.categoryKey)) ||
            row.categoryKey;
          const busy = busyId === row.item.id;
          const detail = String(row.item.approvalNote || '').trim();
          return (
            <li
              key={`${row.categoryKey}__${row.item.id}`}
              className="rounded-2xl border border-violet-100 bg-violet-50/40 p-4 space-y-3"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-violet-700">
                  {label}
                </span>
              </div>
              <p className="text-sm font-bold text-slate-900">
                {row.item.text || '(No description)'}
              </p>
              {detail ? (
                <div className="rounded-xl bg-white border border-violet-100 px-3 py-2.5 space-y-1">
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    What to review
                  </div>
                  <p className="text-sm text-slate-700 font-medium whitespace-pre-wrap break-words">
                    <TextWithLinks text={detail} />
                  </p>
                </div>
              ) : null}
              {row.item.reviewDeadline ? (
                <p className="text-[11px] font-bold text-violet-800 bg-white/80 border border-violet-100 rounded-xl px-3 py-2">
                  {row.item.approvalAutoApprove
                    ? `Auto-approves on ${formatReviewDeadlineLabel(row.item.reviewDeadline)} if you don’t respond.`
                    : `Please review by ${formatReviewDeadlineLabel(row.item.reviewDeadline)}.`}
                </p>
              ) : null}
              <textarea
                value={notes[row.item.id] || ''}
                onChange={(e) =>
                  setNotes((prev) => ({ ...prev, [row.item.id]: e.target.value }))
                }
                rows={2}
                placeholder="Optional feedback for Ignite…"
                className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#fd7414]"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => decide(row, 'revisions_requested')}
                  className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest text-amber-800 bg-amber-50 hover:bg-amber-100 disabled:opacity-40"
                >
                  Request revisions
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => decide(row, 'approved')}
                  className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40"
                >
                  {busy ? 'Saving…' : 'Approve'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

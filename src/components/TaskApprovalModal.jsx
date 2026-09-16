import React, { useMemo, useState } from 'react';
import { authedFetch } from '../utils/authedFetch.js';
import {
  isTodoAwaitingClientApproval,
  isTodoAwaitingStaffApproval,
  isTodoPendingApproval,
  todoApprovalBadgeLabel,
} from '../utils/todoApproval.js';
import { TextWithLinks } from '../utils/textWithLinks.jsx';

/**
 * Modal to finish a task (complete / send for approval), send for review, or decide.
 */
export default function TaskApprovalModal({
  mode: initialMode = 'send', // 'finish' | 'send' | 'decide'
  client,
  cycleStart,
  categoryKey,
  item,
  staffEmails = [],
  currentUserEmail = '',
  onClose,
  onDone,
  onMarkComplete,
}) {
  const [mode, setMode] = useState(initialMode);
  const [target, setTarget] = useState('client');
  const [reviewers, setReviewers] = useState([]);
  const [note, setNote] = useState(() => String(item?.approvalNote || '').trim());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const title = String(item?.text || 'Task').trim() || 'Task';
  const me = String(currentUserEmail || '').trim().toLowerCase();
  const reviewerOptions = useMemo(
    () =>
      [...new Set((staffEmails || []).map((e) => String(e || '').trim().toLowerCase()).filter(Boolean))]
        .filter((e) => e !== me)
        .sort(),
    [staffEmails, me],
  );

  const noteField = (
    <div>
      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">
        {mode === 'decide'
          ? 'Your feedback (optional)'
          : target === 'client' || mode === 'finish'
            ? 'Details for the client'
            : 'Details for the reviewer'}
        {mode === 'send' && target === 'client' ? (
          <span className="text-[#fd7414]"> *</span>
        ) : null}
      </label>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={mode === 'decide' ? 3 : 5}
        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#fd7414] whitespace-pre-wrap"
        placeholder={
          mode === 'decide'
            ? 'Feedback for the team…'
            : 'What should they review?\nPaste page URLs, Drive links, or short instructions…'
        }
      />
      {mode !== 'decide' ? (
        <p className="mt-1 text-[10px] font-medium text-slate-400">
          URLs become clickable links in the portal and are included in the email.
        </p>
      ) : null}
    </div>
  );

  const markCompleteNow = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onMarkComplete?.();
      onDone?.(item);
      onClose?.();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!client?.id || !item?.id || busy) return;
    if (target === 'client' && !String(note || '').trim()) {
      setError('Add details or a URL so the client knows what to approve.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const resp = await authedFetch('/.netlify/functions/client-todo-approval-send', {
        clientId: client.id,
        cycleStart,
        categoryKey,
        itemId: item.id,
        target,
        reviewerEmails: target === 'staff' ? reviewers : [],
        note,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Could not send for approval.');
      onDone?.(data.item);
      onClose?.();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (decision) => {
    if (!client?.id || !item?.id || busy) return;
    setBusy(true);
    setError('');
    try {
      const resp = await authedFetch('/.netlify/functions/client-todo-approval-decide', {
        clientId: client.id,
        cycleStart,
        categoryKey,
        itemId: item.id,
        decision,
        note,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Could not save decision.');
      onDone?.(data.item);
      onClose?.();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-100 p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest">
              {mode === 'decide'
                ? 'Review task'
                : mode === 'finish'
                  ? 'Finish task'
                  : 'Send for approval'}
            </h4>
            <p className="text-xs font-bold text-slate-500 mt-1 line-clamp-2">{title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-bold text-slate-400 hover:text-slate-600"
          >
            Close
          </button>
        </div>

        {mode === 'finish' ? (
          <>
            <p className="text-[11px] font-medium text-slate-500">
              Mark it done now, or send it for client or staff approval first. Social Media
              creative still goes through Planable — this covers the retainer task itself.
            </p>
            {noteField}
            <div className="flex flex-col gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={markCompleteNow}
                className="w-full px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40"
              >
                {busy ? 'Saving…' : 'Mark complete now'}
              </button>
              <button
                type="button"
                disabled={busy || !String(note || '').trim()}
                onClick={() => {
                  setTarget('client');
                  setMode('send');
                }}
                className="w-full px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest text-white bg-[#fd7414] hover:brightness-95 disabled:opacity-40"
                title={
                  !String(note || '').trim()
                    ? 'Add details or a URL above first'
                    : undefined
                }
              >
                Send for client approval
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setTarget('staff');
                  setMode('send');
                }}
                className="w-full px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-40"
              >
                Send for staff review
              </button>
            </div>
          </>
        ) : mode === 'send' ? (
          <>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                Send to
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setTarget('client')}
                  className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest ${
                    target === 'client'
                      ? 'bg-[#fd7414] text-white'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  Client
                </button>
                <button
                  type="button"
                  onClick={() => setTarget('staff')}
                  className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest ${
                    target === 'staff'
                      ? 'bg-[#fd7414] text-white'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  Staff review
                </button>
              </div>
            </div>

            {target === 'staff' ? (
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  Reviewers
                </label>
                <div className="max-h-36 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
                  {reviewerOptions.length === 0 ? (
                    <p className="text-xs text-slate-400 p-3">No other staff emails available.</p>
                  ) : (
                    reviewerOptions.map((email) => {
                      const checked = reviewers.includes(email);
                      return (
                        <label
                          key={email}
                          className="flex items-center gap-2 px-3 py-2 text-xs font-bold text-slate-700 cursor-pointer hover:bg-slate-50"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setReviewers((prev) =>
                                checked
                                  ? prev.filter((e) => e !== email)
                                  : [...prev, email],
                              )
                            }
                          />
                          {email}
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            ) : (
              <p className="text-[11px] font-medium text-slate-500">
                The client will see your details and links on the Approvals tab and can approve
                or request revisions. (Social Media creative still goes through Planable.)
              </p>
            )}
            {noteField}
          </>
        ) : (
          <>
            {item?.approvalNote ? (
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 space-y-1">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Original request note
                </div>
                <p className="text-xs text-slate-700 whitespace-pre-wrap break-words">
                  <TextWithLinks text={item.approvalNote} />
                </p>
              </div>
            ) : null}
            <p className="text-[11px] font-medium text-slate-500">
              {isTodoAwaitingClientApproval(item)
                ? 'Approve to mark the task complete, or request revisions to send it back to Ignite.'
                : 'Approve to mark complete, or request revisions for the assignee.'}
            </p>
            {noteField}
          </>
        )}

        {error ? (
          <p className="text-xs font-bold text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
            {error}
          </p>
        ) : null}

        {mode === 'send' || mode === 'decide' ? (
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            {mode === 'send' ? (
              <button
                type="button"
                disabled={
                  busy ||
                  (target === 'staff' && reviewers.length === 0) ||
                  (target === 'client' && !String(note || '').trim())
                }
                onClick={send}
                className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest text-white bg-[#fd7414] hover:brightness-95 disabled:opacity-40"
              >
                {busy ? 'Sending…' : 'Send'}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => decide('revisions_requested')}
                  className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest text-amber-800 bg-amber-50 hover:bg-amber-100 disabled:opacity-40"
                >
                  Request revisions
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => decide('approved')}
                  className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40"
                >
                  Approve
                </button>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function TodoApprovalBadge({ item }) {
  const label = todoApprovalBadgeLabel(item);
  if (!label) return null;
  const pending = isTodoPendingApproval(item);
  return (
    <span
      className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${
        pending
          ? 'text-violet-800 bg-violet-50'
          : 'text-amber-800 bg-amber-50'
      }`}
    >
      {label}
    </span>
  );
}

export function canCurrentUserDecideStaffApproval(item, email) {
  if (!isTodoAwaitingStaffApproval(item)) return false;
  const me = String(email || '').trim().toLowerCase();
  if (!me) return false;
  const reviewers = (item.approvalReviewerEmails || []).map((e) =>
    String(e || '').trim().toLowerCase(),
  );
  return (
    reviewers.includes(me) ||
    me === String(item.approvalRequestedByEmail || '').toLowerCase()
  );
}

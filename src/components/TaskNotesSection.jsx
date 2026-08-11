import React from 'react';
import { MessageSquare } from 'lucide-react';
import MentionTextarea from './MentionTextarea.jsx';
import { appendTaskComment, buildTaskComment, getTaskComments } from '../utils/taskComments.js';
import { staffHandle } from '../utils/staffDirectory.js';
import { safeDisplayForReact } from '../utils/safeReactText.js';

export default function TaskNotesSection({
  item,
  allItems,
  onPersistItems,
  user,
  staffEmails = [],
  adminUsers = [],
  disabled = false,
  compact = false,
}) {
  const [open, setOpen] = React.useState(!compact);
  const [draft, setDraft] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const comments = getTaskComments(item);

  const save = async () => {
    if (disabled || saving || !onPersistItems) return;
    const comment = buildTaskComment({
      text: draft,
      authorEmail: user?.email,
      authorName: user?.displayName || staffHandle(user?.email),
      staffEmails,
    });
    if (!comment) return;
    setSaving(true);
    try {
      const next = (allItems || []).map((row) =>
        row.id === item.id ? appendTaskComment(row, comment) : row,
      );
      await onPersistItems(next);
      setDraft('');
    } catch (err) {
      window.alert(err?.message || 'Could not save note.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={compact ? 'mt-2' : 'mt-3'}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-[#fd7414]"
      >
        <MessageSquare className="h-3.5 w-3.5" />
        Task notes{comments.length ? ` (${comments.length})` : ''}
      </button>
      {open && (
        <div className="mt-2 space-y-2 rounded-xl border border-slate-100 bg-slate-50/80 p-2">
          {comments.length === 0 ? (
            <p className="text-[11px] italic text-slate-400">No notes yet. Add a comment for the audit trail.</p>
          ) : (
            <ul className="max-h-40 space-y-2 overflow-y-auto pr-1">
              {comments.map((c) => (
                <li key={c.id} className="rounded-lg bg-white px-2 py-1.5 text-xs text-slate-700">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-black text-slate-800">
                      {c.authorName || staffHandle(c.authorEmail)}
                    </span>
                    <span className="text-[9px] font-bold text-slate-400">
                      {c.createdAt
                        ? new Date(c.createdAt).toLocaleString(undefined, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })
                        : ''}
                    </span>
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap break-words">
                    {safeDisplayForReact(c.text)}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <MentionTextarea
            value={draft}
            onChange={setDraft}
            staffEmails={staffEmails}
            adminUsers={adminUsers}
            disabled={disabled || saving}
            onSubmit={save}
          />
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-bold text-slate-400">
              Type @ to tag a teammate · Ctrl/Cmd+Enter to post
            </p>
            <button
              type="button"
              disabled={disabled || saving || !draft.trim()}
              onClick={save}
              className="rounded-lg bg-[#fd7414] px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Post note'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

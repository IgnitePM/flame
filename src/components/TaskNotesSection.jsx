import React from 'react';
import { MessageSquare } from 'lucide-react';
import MentionTextarea from './MentionTextarea.jsx';
import {
  appendTaskComment,
  buildMentionDirectory,
  buildTaskComment,
  getTaskComments,
} from '../utils/taskComments.js';
import { staffHandle } from '../utils/staffDirectory.js';
import { safeDisplayForReact } from '../utils/safeReactText.js';
import { authedFetch } from '../utils/authedFetch.js';

function clientEmailsFromClient(client) {
  return [
    ...new Set(
      (Array.isArray(client?.clientEmails) ? client.clientEmails : [])
        .map((e) => String(e || '').trim().toLowerCase())
        .filter((e) => e.includes('@')),
    ),
  ];
}

export default function TaskNotesSection({
  item,
  allItems,
  onPersistItems,
  user,
  staffEmails = [],
  adminUsers = [],
  client = null,
  clientEmails: clientEmailsProp = null,
  cycleStart = null,
  categoryKey = null,
  disabled = false,
  compact = false,
}) {
  const [open, setOpen] = React.useState(!compact);
  const [draft, setDraft] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const comments = getTaskComments(item);
  const clientEmails =
    clientEmailsProp != null
      ? [
          ...new Set(
            (clientEmailsProp || [])
              .map((e) => String(e || '').trim().toLowerCase())
              .filter((e) => e.includes('@')),
          ),
        ]
      : clientEmailsFromClient(client);
  const clientName = String(client?.name || '').trim();

  const save = async () => {
    if (disabled || saving || !onPersistItems) return;
    const directory = buildMentionDirectory({
      staffEmails,
      adminUsers,
      clientEmails,
      clientName,
    });
    const comment = buildTaskComment({
      text: draft,
      authorEmail: user?.email,
      authorName: user?.displayName || staffHandle(user?.email),
      directory,
    });
    if (!comment) return;
    setSaving(true);
    try {
      const next = (allItems || []).map((row) =>
        row.id === item.id ? appendTaskComment(row, comment) : row,
      );
      await onPersistItems(next);
      setDraft('');

      if (client?.id && comment.clientMentions?.length) {
        try {
          const resp = await authedFetch(
            '/.netlify/functions/client-todo-note-mention',
            {
              clientId: client.id,
              itemId: item.id,
              categoryKey,
              cycleStart,
              taskTitle: item.text || 'Task',
              commentText: comment.text,
              commentId: comment.id,
              mentionedEmails: comment.clientMentions,
            },
          );
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok) {
            window.alert(
              data.error ||
                'Note saved, but the client mention email could not be sent.',
            );
          }
        } catch (err) {
          window.alert(
            err?.message ||
              'Note saved, but the client mention email could not be sent.',
          );
        }
      }
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
            <p className="text-[11px] italic text-slate-400">
              No notes yet. Add a comment for the audit trail.
            </p>
          ) : (
            <ul className="max-h-40 space-y-2 overflow-y-auto pr-1">
              {comments.map((c) => (
                <li
                  key={c.id}
                  className="rounded-lg bg-white px-2 py-1.5 text-xs text-slate-700"
                >
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
                  {Array.isArray(c.clientMentions) && c.clientMentions.length > 0 ? (
                    <p className="mt-1 text-[9px] font-black uppercase tracking-widest text-sky-700">
                      Tagged client
                      {c.clientMentions.length === 1 ? '' : 's'}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <MentionTextarea
            value={draft}
            onChange={setDraft}
            staffEmails={staffEmails}
            adminUsers={adminUsers}
            clientEmails={clientEmails}
            clientName={clientName}
            disabled={disabled || saving}
            onSubmit={save}
            placeholder={
              clientEmails.length
                ? 'Write a note. Use @ to tag a teammate or client…'
                : 'Write a note. Use @name to tag a teammate…'
            }
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[9px] font-bold text-slate-400 order-2 sm:order-1">
              {clientEmails.length
                ? 'Type @ to tag a teammate or client · Ctrl/Cmd+Enter to post'
                : 'Type @ to tag a teammate · Ctrl/Cmd+Enter to post'}
            </p>
            <button
              type="button"
              disabled={disabled || saving || !draft.trim()}
              onClick={save}
              className="order-1 sm:order-2 shrink-0 touch-target rounded-lg bg-[#fd7414] px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40 w-full sm:w-auto"
            >
              {saving ? 'Saving…' : 'Post note'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

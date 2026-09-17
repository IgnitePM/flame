import React from 'react';
import { MessageSquare } from 'lucide-react';
import { TodoApprovalBadge } from './TaskApprovalModal.jsx';
import { isTodoAwaitingClientApproval } from '../utils/todoApproval.js';
import TodoItemAttachments from './TodoItemAttachments.jsx';
import { getTaskComments } from '../utils/taskComments.js';
import { TextWithLinks } from '../utils/textWithLinks.jsx';
import { staffHandle } from '../utils/staffDirectory.js';
import { safeDisplayForReact } from '../utils/safeReactText.js';
import { authedFetch } from '../utils/authedFetch.js';

/**
 * Client-portal task card: separated like kiosk rows, with notes + read-only attachments.
 */
export default function PortalClientTodoItem({
  item,
  client,
  cycleStart,
  categoryKey,
  user,
}) {
  const comments = getTaskComments(item);
  const [notesOpen, setNotesOpen] = React.useState(
    () => comments.length > 0 || Boolean(item?.attachments?.length),
  );
  const [draft, setDraft] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [localComments, setLocalComments] = React.useState(comments);

  React.useEffect(() => {
    setLocalComments(getTaskComments(item));
  }, [item]);

  const postNote = async () => {
    if (saving || !draft.trim() || !client?.id) return;
    setSaving(true);
    try {
      const resp = await authedFetch('/.netlify/functions/client-todo-note-submit', {
        clientId: client.id,
        cycleStart,
        categoryKey,
        itemId: item.id,
        text: draft.trim(),
        authorName: user?.displayName || user?.email || '',
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data.error || 'Could not save note.');
      }
      if (data.comment) {
        setLocalComments((prev) => [...prev, data.comment]);
        setNotesOpen(true);
      }
      setDraft('');
    } catch (err) {
      window.alert(err?.message || 'Could not save note.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <li
      className={`rounded-xl border border-slate-200 bg-white p-4 space-y-3 shadow-sm ${
        item.done ? 'opacity-70' : ''
      }`}
    >
      <div className="space-y-2">
        <p
          className={`text-sm leading-relaxed break-words ${
            item.done
              ? 'text-slate-400 line-through'
              : 'text-slate-900 font-semibold'
          }`}
        >
          {item.text || '(No description)'}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {item.pinned && (
            <span className="text-[9px] font-black uppercase tracking-widest text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
              Pinned
            </span>
          )}
          {item.recurring && (
            <span className="text-[9px] font-black uppercase tracking-widest text-[#fd7414] bg-orange-50 px-1.5 py-0.5 rounded">
              Recurring
            </span>
          )}
          {item.dueDate ? (
            <span className="text-[10px] font-bold text-slate-400">
              Due {new Date(item.dueDate).toLocaleDateString()}
            </span>
          ) : null}
          {Number(item.estimatedHours) > 0 ? (
            <span className="text-[10px] font-bold text-slate-500">
              Est. {Number(item.estimatedHours).toFixed(2)}h
            </span>
          ) : null}
          {item.requestStatus === 'pending' ? (
            <span className="text-[9px] font-black uppercase tracking-widest text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded">
              Pending approval
            </span>
          ) : null}
          <TodoApprovalBadge item={item} />
          {isTodoAwaitingClientApproval(item) ? (
            <span className="text-[9px] font-black uppercase tracking-widest text-violet-700">
              See Approvals tab
            </span>
          ) : null}
        </div>
      </div>

      <TodoItemAttachments item={item} client={client} compact />

      <div className="border-t border-slate-100 pt-3 space-y-2">
        <button
          type="button"
          onClick={() => setNotesOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-[#fd7414]"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Notes{localComments.length ? ` (${localComments.length})` : ''}
        </button>

        {notesOpen ? (
          <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50/80 p-3">
            {localComments.length === 0 ? (
              <p className="text-[11px] italic text-slate-400">
                No notes yet. Add a comment for the Ignite team.
              </p>
            ) : (
              <ul className="max-h-48 space-y-2 overflow-y-auto pr-1">
                {localComments.map((c) => (
                  <li
                    key={c.id}
                    className="rounded-lg bg-white px-2.5 py-2 text-xs text-slate-700 border border-slate-100"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-black text-slate-800">
                        {c.authorName || staffHandle(c.authorEmail) || 'Team'}
                      </span>
                      <span className="text-[9px] font-bold text-slate-400 shrink-0">
                        {c.createdAt
                          ? new Date(c.createdAt).toLocaleString(undefined, {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })
                          : ''}
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words">
                      <TextWithLinks text={safeDisplayForReact(c.text)} />
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              disabled={saving}
              placeholder="Add a note for the Ignite team…"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-[#fd7414]/40 disabled:opacity-50"
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault();
                  postNote();
                }
              }}
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-[9px] font-bold text-slate-400">
                Ctrl/Cmd+Enter to post
              </p>
              <button
                type="button"
                disabled={saving || !draft.trim()}
                onClick={postNote}
                className="shrink-0 rounded-lg bg-[#fd7414] px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40"
              >
                {saving ? 'Saving…' : 'Post note'}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </li>
  );
}

import React from 'react';
import { createPortal } from 'react-dom';
import { Mail, Trash2, X } from 'lucide-react';
import {
  db,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  doc,
  getDoc,
} from '../firebase';
import {
  MAX_TODO_EMAIL_ATTACHMENTS,
  buildEmailAttachmentRecord,
  getTodoEmailAttachments,
  todoHasEmailMessage,
} from '../utils/todoEmailAttachments.js';

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

/**
 * Link CRM emails (clientEmailMessages) onto a primary cycle todo.
 * Snapshot + gmailThreadId stored on the item; picker loads recent client mail.
 */
export default function TodoItemEmailAttachments({
  item,
  client,
  disabled = false,
  onAttach,
  onRemove,
  compact = false,
  maxAttachments = MAX_TODO_EMAIL_ATTACHMENTS,
}) {
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [messages, setMessages] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [pickerSearch, setPickerSearch] = React.useState('');
  const [attaching, setAttaching] = React.useState(false);
  const [preview, setPreview] = React.useState(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);

  const attachments = getTodoEmailAttachments(item);
  const atLimit = attachments.length >= maxAttachments;
  const clientId = String(client?.id || '').trim();

  const openPicker = async () => {
    if (!clientId) {
      window.alert('No client selected.');
      return;
    }
    setPickerOpen(true);
    setPickerSearch('');
    setError('');
    setLoading(true);
    try {
      const q = query(
        collection(db, 'clientEmailMessages'),
        where('clientId', '==', clientId),
        orderBy('sentAt', 'desc'),
        limit(50),
      );
      const snap = await getDocs(q);
      setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (err) {
      setError(
        err?.code === 'failed-precondition'
          ? 'Email index is still building — try again shortly.'
          : err?.message || 'Could not load emails.',
      );
      setMessages([]);
    } finally {
      setLoading(false);
    }
  };

  const attachMessage = async (message) => {
    if (!onAttach || !message?.id) return;
    if (todoHasEmailMessage(item, message.id)) {
      window.alert('This email is already attached.');
      return;
    }
    setAttaching(true);
    try {
      const record = buildEmailAttachmentRecord(message);
      if (!record) throw new Error('Could not build email attachment.');
      await onAttach(record);
      setPickerOpen(false);
    } catch (err) {
      window.alert(err?.message || 'Could not attach email.');
    } finally {
      setAttaching(false);
    }
  };

  const openPreview = async (att) => {
    setPreview({
      subject: att.subject,
      from: att.from,
      direction: att.direction,
      sentAt: att.sentAt,
      body: '',
      loading: true,
      messageId: att.messageId,
      gmailThreadId: att.gmailThreadId,
    });
    setPreviewLoading(true);
    try {
      if (!att.messageId) {
        setPreview((p) => (p ? { ...p, body: '(message unavailable)', loading: false } : p));
        return;
      }
      const snap = await getDoc(doc(db, 'clientEmailMessages', att.messageId));
      if (!snap.exists()) {
        setPreview((p) =>
          p ? { ...p, body: '(message no longer in CRM)', loading: false } : p,
        );
        return;
      }
      const data = snap.data() || {};
      setPreview({
        subject: data.subject || att.subject || '(no subject)',
        from: data.from || data.actorEmail || att.from || '',
        direction: data.direction || att.direction,
        sentAt: data.sentAt || att.sentAt,
        body: String(data.body || '').trim() || '(empty body)',
        loading: false,
        messageId: att.messageId,
        gmailThreadId: data.gmailThreadId || att.gmailThreadId || null,
      });
    } catch (err) {
      setPreview((p) =>
        p
          ? {
              ...p,
              body: err?.message || 'Could not load message.',
              loading: false,
            }
          : p,
      );
    } finally {
      setPreviewLoading(false);
    }
  };

  if (!onAttach && attachments.length === 0) return null;

  const filtered = messages.filter((m) => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return true;
    const to = Array.isArray(m?.to) ? m.to.join(' ') : String(m?.to || '');
    const hay = [m?.subject, m?.from, to, m?.body, m?.actorEmail]
      .map((v) => String(v || '').toLowerCase())
      .join(' ');
    return hay.includes(q);
  });

  const pickerModal =
    pickerOpen && typeof document !== 'undefined'
      ? createPortal(
          <div className="fixed inset-0 z-[400] flex items-end sm:items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-lg max-h-[80vh] overflow-hidden rounded-3xl bg-white shadow-2xl flex flex-col">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                <div className="text-sm font-black text-slate-800">Attach email</div>
                <button
                  type="button"
                  onClick={() => setPickerOpen(false)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="px-4 py-2 border-b border-slate-50">
                <input
                  type="search"
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  placeholder="Search subject, from, body…"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-[#fd7414]"
                />
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {loading ? (
                  <p className="text-xs text-slate-400 font-bold">Loading…</p>
                ) : error ? (
                  <p className="text-xs text-red-600 font-bold">{error}</p>
                ) : filtered.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">
                    {pickerSearch.trim()
                      ? 'No emails match this filter.'
                      : 'No emails for this client yet.'}
                  </p>
                ) : (
                  filtered.map((m) => {
                    const already = todoHasEmailMessage(item, m.id);
                    const inbound = m.direction === 'inbound';
                    return (
                      <button
                        key={m.id}
                        type="button"
                        disabled={attaching || already || atLimit}
                        onClick={() => attachMessage(m)}
                        className="flex w-full flex-col gap-0.5 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-left hover:border-[#fd7414]/40 disabled:opacity-40"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`shrink-0 text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${
                              inbound
                                ? 'bg-sky-50 text-sky-700'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {inbound ? 'In' : 'Out'}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-800">
                            {m.subject || '(no subject)'}
                          </span>
                          {already ? (
                            <span className="text-[9px] font-bold text-slate-400">
                              Attached
                            </span>
                          ) : null}
                        </div>
                        <div className="text-[10px] font-bold text-slate-400 truncate pl-0.5">
                          {inbound
                            ? `From ${m.from || m.actorEmail || 'client'}`
                            : `To ${(m.to || []).join(', ')}`}
                          {m.sentAt ? ` · ${formatWhen(m.sentAt)}` : ''}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
              <div className="border-t border-slate-100 px-4 py-2 text-[10px] font-medium text-slate-400">
                Links the selected message (and keeps its thread id for later).
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  const previewModal =
    preview && typeof document !== 'undefined'
      ? createPortal(
          <div className="fixed inset-0 z-[410] flex items-end sm:items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-lg max-h-[80vh] overflow-hidden rounded-3xl bg-white shadow-2xl flex flex-col">
              <div className="flex items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-black text-slate-800 truncate">
                    {preview.subject || '(no subject)'}
                  </div>
                  <div className="text-[10px] font-bold text-slate-400 mt-0.5">
                    {preview.from ? `${preview.from}` : ''}
                    {preview.sentAt ? ` · ${formatWhen(preview.sentAt)}` : ''}
                    {preview.gmailThreadId ? ' · thread linked' : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-700 shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {preview.loading || previewLoading ? (
                  <p className="text-xs text-slate-400 font-bold">Loading…</p>
                ) : (
                  <pre className="text-xs font-medium text-slate-600 whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-sans">
                    {preview.body}
                  </pre>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div
      className={`w-full space-y-1.5 ${
        compact ? 'ml-8' : 'pt-1'
      } ${attachments.length > 0 && !compact ? 'border-l border-slate-200 pl-3 ml-1' : ''}`}
    >
      {attachments.map((att) => (
        <div
          key={att.id}
          className="flex items-center gap-2 rounded-lg bg-white/80 px-2 py-1.5 text-xs"
        >
          <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <button
            type="button"
            onClick={() => openPreview(att)}
            className="min-w-0 flex-1 truncate text-left font-bold text-[#fd7414] hover:underline"
            title="View email"
          >
            {att.subject || '(no subject)'}
          </button>
          <span className="shrink-0 text-[9px] font-bold text-slate-400">
            {formatWhen(att.sentAt)}
          </span>
          {onRemove && (
            <button
              type="button"
              disabled={disabled || attaching}
              onClick={async () => {
                if (!window.confirm(`Remove email "${att.subject || 'message'}"?`))
                  return;
                try {
                  await onRemove(att.id);
                } catch (err) {
                  window.alert(err?.message || 'Could not remove email.');
                }
              }}
              className="shrink-0 rounded p-1 text-slate-300 hover:text-red-500 disabled:opacity-40"
              title="Remove email attachment"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}

      {onAttach && !disabled && !atLimit && (
        <button
          type="button"
          disabled={attaching}
          onClick={openPicker}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          <Mail className="h-3.5 w-3.5 text-[#fd7414]" />
          {attaching ? 'Working…' : 'Attach email'}
        </button>
      )}

      {pickerModal}
      {previewModal}
    </div>
  );
}

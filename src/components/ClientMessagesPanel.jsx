import React, { useEffect, useRef, useState } from 'react';
import { Link2, Paperclip, Send } from 'lucide-react';
import {
  db,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  limit,
} from '../firebase';
import { authedFetch } from '../utils/authedFetch.js';
import {
  isDriveFolder,
  listDriveFolder,
  uploadFileToDriveFolder,
} from '../utils/clientDrive.js';
import { driveFileViewUrl } from '../utils/clientDrive.js';

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

/**
 * Shared client Messages inbox.
 * @param {'staff'|'portal'} mode
 */
export default function ClientMessagesPanel({
  client,
  mode = 'staff',
  userEmail = '',
  userName = '',
}) {
  const clientId = client?.id;
  const [messages, setMessages] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkLabel, setLinkLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [driveFiles, setDriveFiles] = useState([]);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (!clientId) {
      setMessages([]);
      return undefined;
    }
    const q = query(
      collection(db, 'clientMessages'),
      where('clientId', '==', clientId),
      orderBy('createdAt', 'asc'),
      limit(200),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setLoadError('');
        setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => {
        console.warn('[ClientMessagesPanel]', err);
        setLoadError(
          err?.code === 'failed-precondition'
            ? 'Messages index is still building — try again shortly.'
            : err?.message || 'Could not load messages.',
        );
        setMessages([]);
      },
    );
    return () => unsub();
  }, [clientId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [messages.length]);

  const addLinkAttachment = () => {
    const url = String(linkUrl || '').trim();
    if (!url) return;
    setAttachments((prev) => [
      ...prev,
      {
        id: `link_${Date.now()}`,
        name: String(linkLabel || '').trim() || 'Link',
        url: /^https?:\/\//i.test(url) ? url : `https://${url}`,
      },
    ]);
    setLinkUrl('');
    setLinkLabel('');
  };

  const openDrivePicker = async () => {
    const folderId = String(client?.googleDriveFolderId || '').trim();
    if (!folderId) {
      window.alert('Link or create this client’s Drive folder in the Files tab first.');
      return;
    }
    setPickerOpen(true);
    try {
      const data = await listDriveFolder(folderId);
      setDriveFiles(Array.isArray(data.files) ? data.files : []);
    } catch (err) {
      window.alert(err?.message || 'Could not list Drive files.');
      setPickerOpen(false);
    }
  };

  const attachDriveFile = (file) => {
    if (isDriveFolder(file)) return;
    const url = driveFileViewUrl(file);
    if (!url) return;
    setAttachments((prev) => {
      if (prev.some((a) => a.driveFileId === file.id)) return prev;
      return [
        ...prev,
        {
          id: `drive_${file.id}`,
          name: file.name || 'File',
          url,
          driveFileId: file.id,
          mimeType: file.mimeType || null,
          sizeBytes: Number(file.size || 0),
        },
      ];
    });
    setPickerOpen(false);
  };

  const uploadAndAttach = async (file) => {
    const folderId = String(client?.googleDriveFolderId || '').trim();
    if (!folderId) {
      window.alert('Link a Drive folder before uploading attachments.');
      return;
    }
    setBusy(true);
    try {
      const meta = await uploadFileToDriveFolder(folderId, file);
      attachDriveFile(meta);
    } catch (err) {
      window.alert(err?.message || 'Upload failed.');
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!clientId || busy || !body.trim()) return;
    setBusy(true);
    setBanner('');
    try {
      const resp = await authedFetch('/.netlify/functions/client-message-send', {
        clientId,
        body: body.trim(),
        attachments,
        authorName: userName || userEmail,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Send failed');
      setBody('');
      setAttachments([]);
      if (data.email?.sent > 0) {
        setBanner(
          mode === 'staff'
            ? `Sent — emailed ${data.email.sent} portal contact(s).`
            : 'Sent — Ignite was notified.',
        );
      } else if (data.email?.skipped) {
        setBanner(
          mode === 'staff'
            ? 'Sent. No portal emails on this client yet — add Authorized Emails to notify them.'
            : 'Sent.',
        );
      } else {
        setBanner('Sent.');
      }
    } catch (err) {
      setBanner(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!clientId) return null;

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3 flex flex-col min-h-[420px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
          Messages
        </h5>
        <span className="text-[10px] font-bold text-slate-400">
          Shared inbox with {mode === 'staff' ? 'the client portal' : 'Ignite'}
        </span>
      </div>

      {loadError ? (
        <p className="text-xs font-bold text-amber-700">{loadError}</p>
      ) : null}

      <div className="flex-1 overflow-y-auto space-y-2 max-h-[420px] pr-1 bg-white border border-slate-100 rounded-xl p-3">
        {messages.length === 0 && !loadError ? (
          <p className="text-xs italic text-slate-400 py-8 text-center">
            No messages yet. Start the conversation below.
          </p>
        ) : (
          messages.map((m) => {
            const mine =
              (mode === 'staff' && m.authorType === 'staff') ||
              (mode === 'portal' && m.authorType === 'client');
            return (
              <div
                key={m.id}
                className={`flex ${mine ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 ${
                    mine
                      ? 'bg-[#fd7414] text-white'
                      : 'bg-slate-100 text-slate-800'
                  }`}
                >
                  <div
                    className={`text-[9px] font-black uppercase tracking-widest mb-1 ${
                      mine ? 'text-white/80' : 'text-slate-400'
                    }`}
                  >
                    {m.authorName || m.authorEmail || m.authorType} ·{' '}
                    {formatWhen(m.createdAt)}
                  </div>
                  <div className="text-sm font-medium whitespace-pre-wrap break-words">
                    {m.body}
                  </div>
                  {Array.isArray(m.attachments) && m.attachments.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {m.attachments.map((a) => (
                        <li key={a.id}>
                          <a
                            href={a.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`inline-flex items-center gap-1 text-[11px] font-bold underline ${
                              mine ? 'text-white' : 'text-[#fd7414]'
                            }`}
                          >
                            <Paperclip className="w-3 h-3" />
                            {a.name}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {attachments.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {attachments.map((a) => (
            <span
              key={a.id}
              className="inline-flex items-center gap-1 rounded-lg bg-white border border-slate-200 px-2 py-1 text-[10px] font-bold text-slate-600"
            >
              <Paperclip className="w-3 h-3" />
              {a.name}
              <button
                type="button"
                className="text-slate-400 hover:text-red-500"
                onClick={() =>
                  setAttachments((prev) => prev.filter((x) => x.id !== a.id))
                }
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder={
          mode === 'staff'
            ? 'Message the client…'
            : 'Message the Ignite team…'
        }
        className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-2 focus:ring-[#fd7414]"
      />

      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="url"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          placeholder="Attachment URL"
          className="flex-1 min-w-[140px] bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-[#fd7414]"
        />
        <input
          type="text"
          value={linkLabel}
          onChange={(e) => setLinkLabel(e.target.value)}
          placeholder="Label"
          className="w-28 bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-[#fd7414]"
        />
        <button
          type="button"
          onClick={addLinkAttachment}
          className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-700"
        >
          <Link2 className="w-3.5 h-3.5" />
          Add link
        </button>
        {mode === 'staff' ? (
          <>
            <button
              type="button"
              onClick={openDrivePicker}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-700"
            >
              <Paperclip className="w-3.5 h-3.5" />
              From Drive
            </button>
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-700">
              Upload
              <input
                type="file"
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) uploadAndAttach(f);
                }}
              />
            </label>
          </>
        ) : null}
        <button
          type="button"
          disabled={busy || !body.trim()}
          onClick={send}
          className="ml-auto inline-flex items-center gap-2 rounded-xl bg-black px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40"
        >
          <Send className="w-3.5 h-3.5" />
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>

      {banner ? <p className="text-xs font-bold text-slate-600">{banner}</p> : null}

      {pickerOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md max-h-[70vh] overflow-hidden rounded-3xl bg-white shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <div className="text-sm font-black">Attach from Drive</div>
              <button
                type="button"
                className="text-slate-400 font-black"
                onClick={() => setPickerOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="overflow-y-auto p-3 space-y-2">
              {driveFiles
                .filter((f) => !isDriveFolder(f))
                .map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => attachDriveFile(f)}
                    className="w-full text-left rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs font-bold hover:border-[#fd7414]/40"
                  >
                    {f.name}
                  </button>
                ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

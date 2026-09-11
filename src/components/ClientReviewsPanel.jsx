import React, { useEffect, useState } from 'react';
import { Check, FileText, Paperclip, Plus, RotateCcw } from 'lucide-react';
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
  driveFileViewUrl,
  isDriveFolder,
  listDriveFolder,
  uploadFileToDriveFolder,
} from '../utils/clientDrive.js';

function formatWhen(ms) {
  const n = Number(ms || 0);
  if (!n) return '';
  try {
    return new Date(n).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

function statusBadge(status) {
  const s = String(status || '');
  if (s === 'approved') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  if (s === 'revisions_requested') return 'bg-amber-50 text-amber-800 border-amber-100';
  if (s === 'closed') return 'bg-slate-100 text-slate-500 border-slate-200';
  return 'bg-sky-50 text-sky-700 border-sky-100';
}

function statusLabel(status) {
  const s = String(status || '');
  if (s === 'approved') return 'Approved';
  if (s === 'revisions_requested') return 'Revisions requested';
  if (s === 'closed') return 'Closed';
  return 'Pending approval';
}

/**
 * Deliverable Approvals for a client.
 * @param {'staff'|'portal'} mode
 */
export default function ClientReviewsPanel({ client, mode = 'staff' }) {
  const clientId = client?.id;
  const [reviews, setReviews] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState('');
  const [decisionNotes, setDecisionNotes] = useState({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [driveFiles, setDriveFiles] = useState([]);

  useEffect(() => {
    if (!clientId) {
      setReviews([]);
      return undefined;
    }
    const q = query(
      collection(db, 'clientReviews'),
      where('clientId', '==', clientId),
      orderBy('createdAt', 'desc'),
      limit(100),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setLoadError('');
        setReviews(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => {
        console.warn('[ClientReviewsPanel]', err);
        setLoadError(
          err?.code === 'failed-precondition'
            ? 'Approvals index is still building — try again shortly.'
            : err?.message || 'Could not load approvals.',
        );
        setReviews([]);
      },
    );
    return () => unsub();
  }, [clientId]);

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
      window.alert('Link a Drive folder before uploading.');
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

  const createReview = async () => {
    if (!clientId || busy || !title.trim()) return;
    setBusy(true);
    setBanner('');
    try {
      const resp = await authedFetch('/.netlify/functions/client-review-create', {
        clientId,
        title: title.trim(),
        description: description.trim(),
        attachments,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Could not create approval');
      setTitle('');
      setDescription('');
      setAttachments([]);
      setComposeOpen(false);
      setBanner(
        data.email?.sent > 0
          ? `Approval sent — emailed ${data.email.sent} portal contact(s).`
          : 'Approval created. Add portal emails on the client to email them next time.',
      );
    } catch (err) {
      setBanner(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (reviewId, status) => {
    if (!clientId || busy) return;
    setBusy(true);
    setBanner('');
    try {
      const resp = await authedFetch('/.netlify/functions/client-review-decide', {
        clientId,
        reviewId,
        status,
        decisionNote: decisionNotes[reviewId] || '',
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Could not save decision');
      setBanner(status === 'approved' ? 'Approved.' : 'Revisions requested.');
    } catch (err) {
      setBanner(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!clientId) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            Approvals
          </h5>
          <p className="text-xs font-medium text-slate-500 mt-1">
            {mode === 'staff'
              ? 'Send deliverables for the client to approve or request revisions.'
              : 'Review deliverables from Ignite and approve or request changes.'}
          </p>
        </div>
        {mode === 'staff' ? (
          <button
            type="button"
            onClick={() => setComposeOpen((v) => !v)}
            className="inline-flex items-center gap-2 rounded-xl bg-black px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white"
          >
            <Plus className="w-3.5 h-3.5" />
            {composeOpen ? 'Cancel' : 'New approval'}
          </button>
        ) : null}
      </div>

      {banner ? <p className="text-xs font-bold text-slate-600">{banner}</p> : null}
      {loadError ? <p className="text-xs font-bold text-amber-700">{loadError}</p> : null}

      {mode === 'staff' && composeOpen ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Deliverable title"
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-[#fd7414]"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="What should they approve?"
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-2 focus:ring-[#fd7414]"
          />
          {attachments.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {attachments.map((a) => (
                <span
                  key={a.id}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-bold"
                >
                  <Paperclip className="w-3 h-3" />
                  {a.name}
                  <button
                    type="button"
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
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={openDrivePicker}
              className="rounded-xl border border-slate-200 px-3 py-2 text-[10px] font-black uppercase tracking-widest"
            >
              From Drive
            </button>
            <label className="rounded-xl border border-slate-200 px-3 py-2 text-[10px] font-black uppercase tracking-widest cursor-pointer">
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
            <button
              type="button"
              disabled={busy || !title.trim()}
              onClick={createReview}
              className="ml-auto rounded-xl bg-[#fd7414] px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40"
            >
              {busy ? 'Sending…' : 'Send for approval'}
            </button>
          </div>
        </div>
      ) : null}

      {reviews.length === 0 && !loadError ? (
        <p className="text-xs italic text-slate-400 bg-slate-50 border border-slate-200 rounded-2xl p-6 text-center">
          No approvals yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {reviews.map((r) => (
            <li
              key={r.id}
              className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <FileText className="w-4 h-4 text-[#fd7414] shrink-0" />
                    <h6 className="text-sm font-black text-slate-800">{r.title}</h6>
                    <span
                      className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border ${statusBadge(r.status)}`}
                    >
                      {statusLabel(r.status)}
                    </span>
                  </div>
                  <div className="text-[10px] font-bold text-slate-400 mt-1">
                    {formatWhen(r.createdAt)}
                    {r.createdByEmail ? ` · ${r.createdByEmail}` : ''}
                  </div>
                </div>
              </div>
              {r.description ? (
                <p className="text-sm font-medium text-slate-600 whitespace-pre-wrap">
                  {r.description}
                </p>
              ) : null}
              {Array.isArray(r.attachments) && r.attachments.length > 0 ? (
                <ul className="space-y-1">
                  {r.attachments.map((a) => (
                    <li key={a.id}>
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-bold text-[#fd7414] hover:underline"
                      >
                        <Paperclip className="w-3.5 h-3.5" />
                        {a.name}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
              {r.status !== 'pending' && (r.decisionNote || r.decisionByEmail) ? (
                <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2 text-xs font-medium text-slate-600">
                  <div className="font-black text-slate-400 uppercase tracking-widest text-[9px] mb-1">
                    Client response
                    {r.decisionByEmail ? ` · ${r.decisionByEmail}` : ''}
                    {r.decisionAt ? ` · ${formatWhen(r.decisionAt)}` : ''}
                  </div>
                  {r.decisionNote || '(no note)'}
                </div>
              ) : null}
              {mode === 'portal' && r.status === 'pending' ? (
                <div className="space-y-2 border-t border-slate-100 pt-3">
                  <textarea
                    value={decisionNotes[r.id] || ''}
                    onChange={(e) =>
                      setDecisionNotes((prev) => ({
                        ...prev,
                        [r.id]: e.target.value,
                      }))
                    }
                    rows={2}
                    placeholder="Optional note (required feedback if requesting revisions)"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-2 focus:ring-[#fd7414]"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => decide(r.id, 'approved')}
                      className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => decide(r.id, 'revisions_requested')}
                      className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Request revisions
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {pickerOpen ? (
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/40 p-4">
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

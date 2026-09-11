import React from 'react';
import { createPortal } from 'react-dom';
import { FileText, Folder, Paperclip, Trash2, Upload, X } from 'lucide-react';
import {
  formatFileSize,
  getTodoAttachments,
  MAX_TODO_ATTACHMENTS,
} from '../utils/clientDocuments.js';
import {
  isDriveFolder,
  listDriveFolder,
  uploadFileToDriveFolder,
} from '../utils/clientDrive.js';

/**
 * Task attachments backed by the client's Google Drive folder.
 * Pick an existing Drive file or upload into the client folder.
 */
export default function TodoItemAttachments({
  item,
  client,
  cycleStart,
  categoryKey,
  disabled = false,
  onAttachDriveFile,
  onRemove,
  compact = false,
}) {
  const [uploading, setUploading] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [files, setFiles] = React.useState([]);
  const [folderId, setFolderId] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [pickerSearch, setPickerSearch] = React.useState('');

  const attachments = getTodoAttachments(item);
  const atLimit = attachments.length >= MAX_TODO_ATTACHMENTS;
  const clientFolderId = String(client?.googleDriveFolderId || '').trim();

  const openPicker = async () => {
    if (!clientFolderId) {
      window.alert(
        'Link or create this client’s Google Drive folder in the Files tab first.',
      );
      return;
    }
    setPickerOpen(true);
    setFolderId(clientFolderId);
    setPickerSearch('');
    setError('');
    setLoading(true);
    try {
      const data = await listDriveFolder(clientFolderId);
      setFiles(Array.isArray(data.files) ? data.files : []);
    } catch (err) {
      setError(err?.message || 'Could not load Drive files.');
      setFiles([]);
    } finally {
      setLoading(false);
    }
  };

  const browseFolder = async (id) => {
    setFolderId(id);
    setPickerSearch('');
    setLoading(true);
    setError('');
    try {
      const data = await listDriveFolder(id);
      setFiles(Array.isArray(data.files) ? data.files : []);
    } catch (err) {
      setError(err?.message || 'Could not load folder.');
      setFiles([]);
    } finally {
      setLoading(false);
    }
  };

  const attachExisting = async (file) => {
    if (!onAttachDriveFile || isDriveFolder(file)) return;
    setUploading(true);
    try {
      await onAttachDriveFile(client, file, {
        linkedTodoId: item.id,
        linkedTodoText: item.text || '',
        linkedCategoryKey: categoryKey,
        linkedCycleStart: cycleStart,
      });
      setPickerOpen(false);
    } catch (err) {
      window.alert(err?.message || 'Could not attach file.');
    } finally {
      setUploading(false);
    }
  };

  const handleUpload = async (file) => {
    const targetFolder = String(folderId || clientFolderId || '').trim();
    if (!file || !onAttachDriveFile || !targetFolder) return;
    setUploading(true);
    setError('');
    try {
      const meta = await uploadFileToDriveFolder(targetFolder, file);
      await onAttachDriveFile(client, meta, {
        linkedTodoId: item.id,
        linkedTodoText: item.text || '',
        linkedCategoryKey: categoryKey,
        linkedCycleStart: cycleStart,
      });
      setPickerOpen(false);
    } catch (err) {
      const msg = err?.message || 'Upload failed.';
      setError(msg);
      window.alert(msg);
    } finally {
      setUploading(false);
    }
  };

  if (!onAttachDriveFile && attachments.length === 0) return null;

  const sorted = [...files]
    .filter((f) => {
      const q = pickerSearch.trim().toLowerCase();
      if (!q) return true;
      return String(f?.name || '')
        .toLowerCase()
        .includes(q);
    })
    .sort((a, b) => {
      const af = isDriveFolder(a) ? 0 : 1;
      const bf = isDriveFolder(b) ? 0 : 1;
      if (af !== bf) return af - bf;
      return String(a.name || '').localeCompare(String(b.name || ''), undefined, {
        sensitivity: 'base',
      });
    });

  const pickerModal =
    pickerOpen && typeof document !== 'undefined'
      ? createPortal(
          <div className="fixed inset-0 z-[400] flex items-end sm:items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-lg max-h-[80vh] overflow-hidden rounded-3xl bg-white shadow-2xl flex flex-col">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                <div className="text-sm font-black text-slate-800">Attach from Drive</div>
                <button
                  type="button"
                  onClick={() => setPickerOpen(false)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="px-4 py-2 flex flex-wrap gap-2 border-b border-slate-50">
                {folderId !== clientFolderId ? (
                  <button
                    type="button"
                    onClick={() => browseFolder(clientFolderId)}
                    className="text-[10px] font-black uppercase tracking-widest text-[#fd7414]"
                  >
                    ← Client folder
                  </button>
                ) : null}
                <input
                  type="search"
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  placeholder="Filter by name…"
                  className="flex-1 min-w-[140px] bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-[#fd7414]"
                />
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest text-slate-700">
                  <Upload className="h-3.5 w-3.5" />
                  {uploading ? 'Uploading…' : 'Upload new'}
                  <input
                    type="file"
                    className="sr-only"
                    disabled={uploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      handleUpload(file);
                    }}
                  />
                </label>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {loading ? (
                  <p className="text-xs text-slate-400 font-bold">Loading…</p>
                ) : error ? (
                  <p className="text-xs text-red-600 font-bold">{error}</p>
                ) : sorted.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">
                    {pickerSearch.trim()
                      ? 'No files match this filter.'
                      : 'No files in this folder.'}
                  </p>
                ) : (
                  sorted.map((file) => {
                    const folder = isDriveFolder(file);
                    return (
                      <button
                        key={file.id}
                        type="button"
                        disabled={uploading}
                        onClick={() =>
                          folder ? browseFolder(file.id) : attachExisting(file)
                        }
                        className="flex w-full items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-left hover:border-[#fd7414]/40 disabled:opacity-40"
                      >
                        {folder ? (
                          <Folder className="h-4 w-4 shrink-0 text-[#fd7414]" />
                        ) : (
                          <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                        )}
                        <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-800">
                          {file.name}
                        </span>
                        {!folder ? (
                          <span className="text-[9px] font-bold text-slate-400">
                            {formatFileSize(Number(file.size || 0))}
                          </span>
                        ) : (
                          <span className="text-[9px] font-bold text-slate-400">Open</span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
              <div className="border-t border-slate-100 px-4 py-2 text-[10px] font-medium text-slate-400">
                Choosing a file attaches it to this task. Upload puts the file in the folder you’re browsing.
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
      {attachments.map((doc) => (
        <div
          key={doc.id}
          className="flex items-center gap-2 rounded-lg bg-white/80 px-2 py-1.5 text-xs"
        >
          <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          {doc.url ? (
            <a
              href={doc.url}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 flex-1 truncate font-bold text-[#fd7414] hover:underline"
            >
              {doc.name}
            </a>
          ) : (
            <span className="min-w-0 flex-1 truncate font-bold text-slate-700">
              {doc.name}
            </span>
          )}
          <span className="shrink-0 text-[9px] font-bold text-slate-400">
            {formatFileSize(doc.sizeBytes)}
          </span>
          {onRemove && (
            <button
              type="button"
              disabled={disabled || uploading}
              onClick={async () => {
                if (!window.confirm(`Remove "${doc.name}"?`)) return;
                try {
                  await onRemove(client, doc.id);
                } catch (err) {
                  window.alert(err?.message || 'Could not remove file.');
                }
              }}
              className="shrink-0 rounded p-1 text-slate-300 hover:text-red-500 disabled:opacity-40"
              title="Remove attachment"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}

      {onAttachDriveFile && !disabled && !atLimit && (
        <button
          type="button"
          disabled={uploading}
          onClick={openPicker}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          <Paperclip className="h-3.5 w-3.5 text-[#fd7414]" />
          {uploading ? 'Working…' : 'Attach from Drive'}
        </button>
      )}

      {pickerModal}
    </div>
  );
}

import React from 'react';
import { ExternalLink, FileText, Paperclip, Trash2, Upload } from 'lucide-react';
import { formatFileSize, normalizeExternalUrl } from '../utils/clientDocuments.js';

function ExternalOpenButton({ href, label }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-[#fd7414] hover:bg-orange-50"
    >
      <ExternalLink className="w-3.5 h-3.5" />
      {label}
    </a>
  );
}

export default function ClientFilesPanel({
  client,
  documents = [],
  onUpload,
  onRemove,
  disabled = false,
  canDelete = true,
}) {
  const [uploading, setUploading] = React.useState(false);
  const sorted = [...documents].sort(
    (a, b) => Number(b.uploadedAt || 0) - Number(a.uploadedAt || 0),
  );
  const driveUrl = normalizeExternalUrl(client?.googleDriveFolderUrl);
  const hubspotUrl = normalizeExternalUrl(client?.hubspotProfileUrl);

  const handleFile = async (file) => {
    if (!file || !onUpload) return;
    setUploading(true);
    try {
      await onUpload(client, file, {});
    } catch (err) {
      window.alert(err?.message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
          Client files ({sorted.length})
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExternalOpenButton href={driveUrl} label="Open Drive" />
          <ExternalOpenButton href={hubspotUrl} label="Open HubSpot" />
          <label
          className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-700 hover:bg-slate-50 ${
            disabled || uploading ? 'pointer-events-none opacity-40' : ''
          }`}
        >
          <Upload className="w-3.5 h-3.5" />
          {uploading ? 'Uploading…' : 'Upload file'}
          <input
            type="file"
            className="sr-only"
            disabled={disabled || uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              handleFile(file);
            }}
          />
        </label>
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="text-xs italic text-slate-400">
          No files yet. Upload contracts, brand guides, or attach files from tasks.
        </p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((doc) => (
            <li
              key={doc.id}
              className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-3"
            >
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <div className="min-w-0 flex-1">
                {doc.url ? (
                  <a
                    href={doc.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate text-sm font-bold text-[#fd7414] hover:underline"
                  >
                    {doc.name}
                  </a>
                ) : (
                  <span className="block truncate text-sm font-bold text-slate-800">
                    {doc.name}
                  </span>
                )}
                <div className="mt-0.5 text-[10px] font-bold text-slate-400">
                  {formatFileSize(doc.sizeBytes)}
                  {doc.uploadedAt
                    ? ` · ${new Date(doc.uploadedAt).toLocaleDateString()}`
                    : ''}
                  {doc.linkedTodoText ? (
                    <span className="text-slate-500">
                      {' '}
                      · Task: {doc.linkedTodoText}
                    </span>
                  ) : null}
                </div>
              </div>
              {canDelete && onRemove && (
                <button
                  type="button"
                  disabled={disabled || uploading}
                  onClick={async () => {
                    if (
                      !window.confirm(`Remove "${doc.name}" from this client?`)
                    ) {
                      return;
                    }
                    try {
                      await onRemove(client, doc.id);
                    } catch (err) {
                      window.alert(err?.message || 'Could not remove file.');
                    }
                  }}
                  className="shrink-0 rounded-lg p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                  title="Remove file"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="flex items-start gap-1.5 text-[10px] font-medium text-slate-400">
        <Paperclip className="mt-0.5 h-3 w-3 shrink-0" />
        Files attached to tasks also appear here. Max 25 MB per file.
      </p>
    </div>
  );
}

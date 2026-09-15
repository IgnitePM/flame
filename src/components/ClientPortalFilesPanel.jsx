import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, FileText, FolderOpen, Loader2, Upload } from 'lucide-react';
import { authedFetch } from '../utils/authedFetch.js';
import {
  driveFileViewUrl,
  isDriveFolder,
  MAX_CLIENT_FILE_BYTES,
  uploadFileToClientSharedFolder,
} from '../utils/clientDrive.js';
import { formatFileSize } from '../utils/clientDocuments.js';

/**
 * Portal: browse + upload files in the client's "Shared with client" Drive folder only.
 */
export default function ClientPortalFilesPanel({ client }) {
  const clientId = client?.id;
  const fileInputRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [folder, setFolder] = useState(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [banner, setBanner] = useState('');
  const [emptyReason, setEmptyReason] = useState('');

  const loadFiles = useCallback(async () => {
    if (!clientId) return;
    setBusy(true);
    setError('');
    setEmptyReason('');
    try {
      const resp = await authedFetch('/.netlify/functions/drive-list-client-shared', {
        clientId,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Could not load files');
      setFolder(data.folder || null);
      setFiles(Array.isArray(data.files) ? data.files : []);
      setEmptyReason(data.emptyReason || '');
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }, [clientId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!clientId || cancelled) return;
      await loadFiles();
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, loadFiles]);

  const onPickFiles = async (event) => {
    const list = Array.from(event.target.files || []);
    event.target.value = '';
    if (!list.length || !clientId || uploading) return;
    if (emptyReason === 'no_shared_folder' || !folder?.id) {
      setError(
        'Shared folder is not set up yet. Ask Ignite to open Files for this client in the CRM first.',
      );
      return;
    }

    setUploading(true);
    setError('');
    setBanner('');
    const uploaded = [];
    const failed = [];
    try {
      for (const file of list) {
        try {
          await uploadFileToClientSharedFolder(clientId, file);
          uploaded.push(file.name);
        } catch (err) {
          failed.push(`${file.name}: ${err?.message || 'failed'}`);
        }
      }
      await loadFiles();
      if (uploaded.length) {
        setBanner(
          uploaded.length === 1
            ? `Uploaded “${uploaded[0]}”.`
            : `Uploaded ${uploaded.length} files.`,
        );
      }
      if (failed.length) {
        setError(failed.join(' · '));
      }
    } finally {
      setUploading(false);
    }
  };

  const canUpload = !!folder?.id && emptyReason !== 'no_shared_folder';

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            Shared files
          </h5>
          <p className="text-xs font-medium text-slate-500 mt-1">
            Files you and Ignite share
            {folder?.name ? ` · ${folder.name}` : ''}
          </p>
          <p className="text-[10px] font-bold text-slate-400 mt-1">
            Max {formatFileSize(MAX_CLIENT_FILE_BYTES)} per file
          </p>
        </div>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={onPickFiles}
          />
          <button
            type="button"
            disabled={!canUpload || busy || uploading}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-xl bg-[#fd7414] px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40"
            title={
              canUpload
                ? 'Upload to shared folder'
                : 'Shared folder not available yet'
            }
          >
            {uploading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Upload className="w-3.5 h-3.5" />
            )}
            {uploading ? 'Uploading…' : 'Upload files'}
          </button>
        </div>
      </div>

      {busy && !uploading ? (
        <div className="flex items-center gap-2 text-sm font-bold text-slate-400 py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading…
        </div>
      ) : null}

      {banner ? <p className="text-xs font-bold text-emerald-700">{banner}</p> : null}
      {error ? <p className="text-xs font-bold text-amber-700">{error}</p> : null}

      {!busy && !error && emptyReason === 'no_shared_folder' ? (
        <p className="text-sm italic text-slate-400 text-center py-10">
          Shared folder is not set up yet. Ask Ignite to enable Files for your account.
        </p>
      ) : null}

      {!busy && emptyReason !== 'no_shared_folder' && files.length === 0 ? (
        <p className="text-sm italic text-slate-400 text-center py-10">
          No shared files yet — upload one to get started.
        </p>
      ) : null}

      {!busy && files.length > 0 ? (
        <ul className="space-y-2">
          {files.map((f) => {
            const url = driveFileViewUrl(f);
            const folderItem = isDriveFolder(f);
            return (
              <li key={f.id}>
                <a
                  href={url || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 hover:border-[#fd7414]/40 transition-colors"
                >
                  {folderItem ? (
                    <FolderOpen className="w-4 h-4 text-amber-500 shrink-0" />
                  ) : (
                    <FileText className="w-4 h-4 text-[#fd7414] shrink-0" />
                  )}
                  <span className="flex-1 text-sm font-bold text-slate-800 truncate">
                    {f.name || 'File'}
                  </span>
                  <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                </a>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

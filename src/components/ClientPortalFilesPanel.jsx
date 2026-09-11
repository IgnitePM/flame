import React, { useEffect, useState } from 'react';
import { ExternalLink, FileText, FolderOpen, Loader2 } from 'lucide-react';
import { authedFetch } from '../utils/authedFetch.js';
import { driveFileViewUrl, isDriveFolder } from '../utils/clientDrive.js';

/**
 * Portal: browse files in the client's "Shared with client" Drive folder only.
 */
export default function ClientPortalFilesPanel({ client }) {
  const clientId = client?.id;
  const [files, setFiles] = useState([]);
  const [folder, setFolder] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [emptyReason, setEmptyReason] = useState('');

  useEffect(() => {
    if (!clientId) return undefined;
    let cancelled = false;
    (async () => {
      setBusy(true);
      setError('');
      setEmptyReason('');
      try {
        const resp = await authedFetch('/.netlify/functions/drive-list-client-shared', {
          clientId,
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error || 'Could not load files');
        if (cancelled) return;
        setFolder(data.folder || null);
        setFiles(Array.isArray(data.files) ? data.files : []);
        setEmptyReason(data.emptyReason || '');
      } catch (err) {
        if (!cancelled) setError(err?.message || String(err));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
      <div>
        <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
          Shared files
        </h5>
        <p className="text-xs font-medium text-slate-500 mt-1">
          Files Ignite has shared with you
          {folder?.name ? ` · ${folder.name}` : ''}
        </p>
      </div>

      {busy ? (
        <div className="flex items-center gap-2 text-sm font-bold text-slate-400 py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading…
        </div>
      ) : null}

      {error ? <p className="text-xs font-bold text-amber-700">{error}</p> : null}

      {!busy && !error && (emptyReason === 'no_shared_folder' || files.length === 0) ? (
        <p className="text-sm italic text-slate-400 text-center py-10">
          No shared files yet.
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

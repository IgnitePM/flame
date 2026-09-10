import React, { useCallback, useEffect, useState } from 'react';
import { FolderOpen, HardDrive, Link2, Unlink } from 'lucide-react';
import { authedFetch } from '../utils/authedFetch.js';

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
 * Admin Config: connect company Google Drive + pick Shared Drive / root folder.
 */
export default function DriveConnectCard({ canManage = false, onTabFocus }) {
  const [status, setStatus] = useState({
    loading: true,
    connected: false,
    driveEmail: '',
    rootFolderId: '',
    rootFolderName: '',
  });
  const [drives, setDrives] = useState([]);
  const [busy, setBusy] = useState('');
  const [banner, setBanner] = useState('');
  const [customFolderId, setCustomFolderId] = useState('');

  const refresh = useCallback(async () => {
    if (!canManage) {
      setStatus((s) => ({ ...s, loading: false }));
      return;
    }
    try {
      const resp = await authedFetch('/.netlify/functions/drive-oauth-status', {});
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Status failed');
      setStatus({
        loading: false,
        connected: Boolean(data.connected),
        driveEmail: data.driveEmail || '',
        connectedAt: data.connectedAt || null,
        connectedByEmail: data.connectedByEmail || '',
        rootFolderId: data.rootFolderId || '',
        rootFolderName: data.rootFolderName || '',
        sharedDriveId: data.sharedDriveId || '',
      });
      if (data.connected) {
        const roots = await authedFetch('/.netlify/functions/drive-list-roots', {});
        const rootData = await roots.json().catch(() => ({}));
        if (roots.ok) setDrives(Array.isArray(rootData.drives) ? rootData.drives : []);
      } else {
        setDrives([]);
      }
    } catch (err) {
      setStatus({
        loading: false,
        connected: false,
        driveEmail: '',
        rootFolderId: '',
        rootFolderName: '',
        error: err?.message || String(err),
      });
    }
  }, [canManage]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search || '');
      const drive = params.get('drive');
      if (!drive) return;
      onTabFocus?.();
      if (drive === 'connected') setBanner('Google Drive connected. Pick a Shared Drive root below.');
      else if (drive === 'error') {
        setBanner(params.get('driveMsg') || 'Drive connect failed.');
      }
      params.delete('drive');
      params.delete('driveMsg');
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash || ''}`;
      window.history.replaceState({}, '', next);
    } catch {
      /* ignore */
    }
  }, [onTabFocus]);

  const connect = async () => {
    if (busy) return;
    setBusy('connect');
    setBanner('');
    try {
      const resp = await authedFetch('/.netlify/functions/drive-oauth-start', {});
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.authUrl) throw new Error(data.error || 'Could not start connect');
      window.location.href = data.authUrl;
    } catch (err) {
      setBanner(err?.message || String(err));
      setBusy('');
    }
  };

  const disconnect = async () => {
    if (busy) return;
    if (
      !window.confirm(
        'Disconnect company Google Drive? Client file browse/upload in the CRM will stop until you reconnect.',
      )
    ) {
      return;
    }
    setBusy('disconnect');
    setBanner('');
    try {
      const resp = await authedFetch('/.netlify/functions/drive-oauth-disconnect', {});
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Disconnect failed');
      setBanner('Drive disconnected.');
      await refresh();
    } catch (err) {
      setBanner(err?.message || String(err));
    } finally {
      setBusy('');
    }
  };

  const setRoot = async ({ rootFolderId, rootFolderName, sharedDriveId }) => {
    if (busy || !rootFolderId) return;
    setBusy('root');
    setBanner('');
    try {
      const resp = await authedFetch('/.netlify/functions/drive-set-root', {
        rootFolderId,
        rootFolderName: rootFolderName || '',
        sharedDriveId: sharedDriveId || '',
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Could not set root');
      setBanner(`Root set to “${data.rootFolderName || rootFolderName || rootFolderId}”.`);
      await refresh();
    } catch (err) {
      setBanner(err?.message || String(err));
    } finally {
      setBusy('');
    }
  };

  if (!canManage) return null;

  return (
    <div className="bg-white p-8 rounded-[32px] border border-slate-100 shadow-sm text-left">
      <h3 className="font-black text-xl mb-2 flex items-center gap-2">
        <HardDrive className="w-5 h-5 text-[#fd7414]" />
        Google Drive (CRM files)
      </h3>
      <p className="text-sm text-slate-500 font-medium mb-6">
        Connect one company Workspace account (e.g. chris@). Client files live in Drive —
        browse and upload from the CRM. Prefer a Shared Drive as the root so files belong
        to the company, not one mailbox.
      </p>

      {status.loading ? (
        <p className="text-sm font-bold text-slate-400">Checking connection…</p>
      ) : status.connected ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/80 px-4 py-3">
            <div className="text-[10px] font-black uppercase tracking-widest text-emerald-700">
              Connected
            </div>
            <div className="text-sm font-bold text-slate-800 mt-1">{status.driveEmail}</div>
            {status.connectedAt ? (
              <div className="text-[11px] font-bold text-slate-400 mt-1">
                Connected {formatWhen(status.connectedAt)}
                {status.connectedByEmail ? ` by ${status.connectedByEmail}` : ''}
              </div>
            ) : null}
            <div className="text-[11px] font-bold text-slate-600 mt-2">
              Root:{' '}
              {status.rootFolderId
                ? status.rootFolderName || status.rootFolderId
                : 'Not set — pick below'}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Client folders root
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!!busy}
                onClick={() =>
                  setRoot({
                    rootFolderId: 'root',
                    rootFolderName: 'My Drive',
                    sharedDriveId: '',
                  })
                }
                className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-[11px] font-black border ${
                  status.rootFolderId === 'root'
                    ? 'border-[#fd7414] bg-orange-50 text-[#fd7414]'
                    : 'border-slate-200 bg-white text-slate-700'
                } disabled:opacity-40`}
              >
                <FolderOpen className="w-3.5 h-3.5" />
                My Drive
              </button>
              {drives.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  disabled={!!busy}
                  onClick={() =>
                    setRoot({
                      rootFolderId: d.id,
                      rootFolderName: d.name,
                      sharedDriveId: d.id,
                    })
                  }
                  className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-[11px] font-black border ${
                    status.rootFolderId === d.id
                      ? 'border-[#fd7414] bg-orange-50 text-[#fd7414]'
                      : 'border-slate-200 bg-white text-slate-700'
                  } disabled:opacity-40`}
                >
                  <HardDrive className="w-3.5 h-3.5" />
                  {d.name}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 items-center pt-1">
              <input
                type="text"
                value={customFolderId}
                onChange={(e) => setCustomFolderId(e.target.value)}
                placeholder="Or paste a folder ID / URL"
                className="flex-1 min-w-[200px] bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#fd7414]"
              />
              <button
                type="button"
                disabled={!!busy || !customFolderId.trim()}
                onClick={() => {
                  const raw = customFolderId.trim();
                  const idMatch = raw.match(/\/folders\/([a-zA-Z0-9_-]+)/);
                  const id =
                    idMatch?.[1] ||
                    (/^[a-zA-Z0-9_-]{10,}$/.test(raw) ? raw : '');
                  if (!id) {
                    setBanner('Could not parse a folder ID from that value.');
                    return;
                  }
                  setRoot({ rootFolderId: id, rootFolderName: '', sharedDriveId: '' });
                }}
                className="px-4 py-2 rounded-xl text-[11px] font-black bg-slate-900 text-white disabled:opacity-40"
              >
                Use folder
              </button>
            </div>
          </div>

          <button
            type="button"
            disabled={!!busy}
            onClick={disconnect}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl font-black bg-white border border-slate-200 text-slate-700 disabled:opacity-40"
          >
            <Unlink className="w-4 h-4" />
            Disconnect
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm font-bold text-amber-800 bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3">
            Not connected — client file browse/upload requires company Drive.
          </p>
          <button
            type="button"
            disabled={!!busy}
            onClick={connect}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl font-black bg-black text-white disabled:opacity-40"
          >
            <Link2 className="w-4 h-4" />
            {busy === 'connect' ? 'Redirecting…' : 'Connect Google Drive'}
          </button>
          {status.error ? (
            <p className="text-sm font-bold text-red-600">{status.error}</p>
          ) : null}
        </div>
      )}

      {banner ? (
        <p className="text-sm font-bold text-slate-600 mt-4">{banner}</p>
      ) : null}
    </div>
  );
}

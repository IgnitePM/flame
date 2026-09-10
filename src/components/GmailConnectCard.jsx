import React, { useCallback, useEffect, useState } from 'react';
import { Link2, Mail, RefreshCw, Unlink } from 'lucide-react';
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
 * Admin Config card: connect personal Gmail for CRM send + sync.
 */
export default function GmailConnectCard({ canManage = false, onTabFocus }) {
  const [status, setStatus] = useState({
    loading: true,
    connected: false,
    gmailEmail: '',
    lastSyncAt: null,
  });
  const [busy, setBusy] = useState('');
  const [banner, setBanner] = useState('');

  const refresh = useCallback(async () => {
    if (!canManage) {
      setStatus((s) => ({ ...s, loading: false }));
      return;
    }
    try {
      const resp = await authedFetch('/.netlify/functions/gmail-oauth-status', {});
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Status failed');
      setStatus({
        loading: false,
        connected: Boolean(data.connected),
        gmailEmail: data.gmailEmail || '',
        lastSyncAt: data.lastSyncAt || null,
      });
    } catch (err) {
      setStatus({
        loading: false,
        connected: false,
        gmailEmail: '',
        lastSyncAt: null,
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
      const gmail = params.get('gmail');
      if (!gmail) return;
      onTabFocus?.();
      if (gmail === 'connected') setBanner('Gmail connected.');
      else if (gmail === 'error') {
        setBanner(params.get('gmailMsg') || 'Gmail connect failed.');
      }
      params.delete('gmail');
      params.delete('gmailMsg');
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
      const resp = await authedFetch('/.netlify/functions/gmail-oauth-start', {});
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
    if (!window.confirm('Disconnect Gmail? You will need to reconnect before sending client email.')) {
      return;
    }
    setBusy('disconnect');
    setBanner('');
    try {
      const resp = await authedFetch('/.netlify/functions/gmail-oauth-disconnect', {});
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Disconnect failed');
      setBanner('Gmail disconnected.');
      await refresh();
    } catch (err) {
      setBanner(err?.message || String(err));
    } finally {
      setBusy('');
    }
  };

  const syncNow = async () => {
    if (busy) return;
    setBusy('sync');
    setBanner('');
    try {
      const resp = await authedFetch('/.netlify/functions/sync-gmail-clients', {});
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Sync failed');
      setBanner(
        `Synced — ${data.upserted || 0} new message${data.upserted === 1 ? '' : 's'} matched to clients.`,
      );
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
        <Mail className="w-5 h-5 text-[#fd7414]" />
        Gmail (CRM)
      </h3>
      <p className="text-sm text-slate-500 font-medium mb-6">
        Connect your Google Workspace Gmail to send client email from Ignite and sync
        matching threads into each client’s history (CRM contact emails and the same
        domain as the client website). Digests still use the shared SMTP mailbox.
      </p>

      {status.loading ? (
        <p className="text-sm font-bold text-slate-400">Checking connection…</p>
      ) : status.connected ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/80 px-4 py-3">
            <div className="text-[10px] font-black uppercase tracking-widest text-emerald-700">
              Connected
            </div>
            <div className="text-sm font-bold text-slate-800 mt-1">{status.gmailEmail}</div>
            {status.lastSyncAt ? (
              <div className="text-[11px] font-bold text-slate-400 mt-1">
                Last sync {formatWhen(status.lastSyncAt)}
              </div>
            ) : (
              <div className="text-[11px] font-bold text-slate-400 mt-1">
                Not synced yet — use Sync now or wait for the 15‑minute job.
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={!!busy}
              onClick={syncNow}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl font-black bg-black text-white disabled:opacity-40"
            >
              <RefreshCw className={`w-4 h-4 ${busy === 'sync' ? 'animate-spin' : ''}`} />
              {busy === 'sync' ? 'Syncing…' : 'Sync now'}
            </button>
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
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm font-bold text-amber-800 bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3">
            Not connected — client compose requires your Gmail.
          </p>
          <button
            type="button"
            disabled={!!busy}
            onClick={connect}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl font-black bg-black text-white disabled:opacity-40"
          >
            <Link2 className="w-4 h-4" />
            {busy === 'connect' ? 'Redirecting…' : 'Connect Gmail'}
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

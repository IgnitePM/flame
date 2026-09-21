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
 * Recent Sync now only (full-history sync removed from UI — Gmail quota).
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
  const [tokenDead, setTokenDead] = useState(false);

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
    setBanner('Starting Gmail sync…');
    try {
      let totalUpserted = 0;
      let totalScanned = 0;
      let totalSkipped = 0;
      let lastHint = '';
      let restart = true;
      const maxSteps = 40;

      for (let step = 0; step < maxSteps; step += 1) {
        const resp = await authedFetch('/.netlify/functions/sync-gmail-clients-http', {
          mode: 'recent',
          restart,
        });
        restart = false;
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          const msg = String(data.error || '');
          if (/expired|revoked|invalid_grant|reconnect/i.test(msg)) {
            setTokenDead(true);
            throw new Error(
              'Gmail access was revoked or expired. Click Reconnect Gmail below, approve access, then Sync now again.',
            );
          }
          if (/quota|rate limit|units per minute/i.test(msg)) {
            throw new Error(
              'Gmail API quota hit — wait a minute and try Sync now again.',
            );
          }
          if (resp.status === 504 || /504|timeout|timed out/i.test(msg)) {
            throw new Error(
              'Sync timed out on this step. Click Sync now again — it will resume where it left off.',
            );
          }
          throw new Error(
            data.error ||
              `Sync failed (HTTP ${resp.status}). Check Netlify function logs for sync-gmail-clients-http.`,
          );
        }
        setTokenDead(false);
        totalUpserted += Number(data.upserted || 0);
        totalScanned += Number(data.scanned || 0);
        totalSkipped += Number(data.skipped || 0);
        lastHint = data.hint || lastHint;
        const progress = data.progress;
        if (progress) {
          setBanner(
            `Syncing… chunk ${progress.chunk}/${progress.totalChunks} · ${progress.scanned} scanned · ${progress.upserted} matched`,
          );
        }
        if (data.done || data.continue === false) {
          break;
        }
        if (step === maxSteps - 1) {
          lastHint =
            (lastHint ? `${lastHint} ` : '') +
            'Stopped after many steps — click Sync now again to continue.';
        }
      }

      if (totalUpserted > 0) {
        setBanner(
          `Synced — ${totalUpserted} new message${totalUpserted === 1 ? '' : 's'} added` +
            (totalScanned ? ` (reviewed ${totalScanned}` : '') +
            (totalSkipped
              ? `, ${totalSkipped} already in CRM or unmatched)`
              : totalScanned
                ? ')'
                : '') +
            '.',
        );
      } else {
        setBanner(
          lastHint ||
            `No new messages` +
              (totalScanned ? ` after reviewing ${totalScanned}` : '') +
              (totalSkipped
                ? ` (${totalSkipped} already synced or unmatched)`
                : '') +
              '.',
        );
      }
      await refresh();
    } catch (err) {
      setBanner(err?.message || String(err));
    } finally {
      setBusy('');
    }
  };

  const reconnect = async () => {
    if (busy) return;
    setBusy('connect');
    setBanner('');
    try {
      // Clear the dead token first so status doesn't keep saying "Connected".
      try {
        await authedFetch('/.netlify/functions/gmail-oauth-disconnect', {});
      } catch {
        /* still try OAuth start */
      }
      const resp = await authedFetch('/.netlify/functions/gmail-oauth-start', {});
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.authUrl) throw new Error(data.error || 'Could not start reconnect');
      window.location.href = data.authUrl;
    } catch (err) {
      setBanner(err?.message || String(err));
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
        matching threads into each client’s history (CRM contact emails and website domains).
        Sync now re-scans the last ~14 days of CRM-matched mail in small steps
        (so it does not time out). The Emails tab only shows what has already been
        synced — use Sync now here if that list looks stale.
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
                Not synced yet — use Sync now.
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={!!busy || tokenDead}
              onClick={syncNow}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl font-black bg-black text-white disabled:opacity-40"
            >
              <RefreshCw className={`w-4 h-4 ${busy === 'sync' ? 'animate-spin' : ''}`} />
              {busy === 'sync' ? 'Syncing…' : 'Sync now'}
            </button>
            {tokenDead ? (
              <button
                type="button"
                disabled={!!busy}
                onClick={reconnect}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl font-black bg-[#fd7414] text-white disabled:opacity-40"
              >
                <Link2 className={`w-4 h-4 ${busy === 'connect' ? 'animate-pulse' : ''}`} />
                {busy === 'connect' ? 'Redirecting…' : 'Reconnect Gmail'}
              </button>
            ) : (
              <button
                type="button"
                disabled={!!busy}
                onClick={disconnect}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl font-black bg-white border border-slate-200 text-slate-700 disabled:opacity-40"
              >
                <Unlink className="w-4 h-4" />
                Disconnect
              </button>
            )}
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

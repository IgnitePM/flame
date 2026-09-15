import React, { useCallback, useEffect, useState } from 'react';
import { Link2, Megaphone, Unlink } from 'lucide-react';
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
 * Admin Config: connect company Google Ads for portal Analytics → Ads.
 */
export default function GoogleAdsConnectCard({ canManage = false, onTabFocus }) {
  const [status, setStatus] = useState({ loading: true, connected: false, adsEmail: '' });
  const [customers, setCustomers] = useState([]);
  const [busy, setBusy] = useState('');
  const [banner, setBanner] = useState('');

  const refresh = useCallback(async () => {
    if (!canManage) {
      setStatus((s) => ({ ...s, loading: false }));
      return;
    }
    try {
      const resp = await authedFetch('/.netlify/functions/google-ads-oauth-status', {});
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Status failed');
      setStatus({
        loading: false,
        connected: Boolean(data.connected),
        adsEmail: data.adsEmail || '',
        connectedAt: data.connectedAt || null,
        connectedByEmail: data.connectedByEmail || '',
      });
      if (data.connected) {
        const listResp = await authedFetch('/.netlify/functions/google-ads-list-customers', {});
        const listData = await listResp.json().catch(() => ({}));
        if (listResp.ok) {
          setCustomers(Array.isArray(listData.customers) ? listData.customers : []);
        } else {
          setCustomers([]);
          if (listData.error) setBanner(listData.error);
        }
      } else {
        setCustomers([]);
      }
    } catch (err) {
      setStatus({
        loading: false,
        connected: false,
        adsEmail: '',
        error: err?.message || String(err),
      });
      setCustomers([]);
    }
  }, [canManage]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search || '');
      const ads = params.get('ads');
      if (!ads) return;
      onTabFocus?.();
      if (ads === 'connected') {
        setBanner(
          'Google Ads connected. Link each client to a customer ID in their CRM profile.',
        );
      } else if (ads === 'error') {
        setBanner(params.get('adsMsg') || 'Google Ads connect failed.');
      }
      params.delete('ads');
      params.delete('adsMsg');
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
      const resp = await authedFetch('/.netlify/functions/google-ads-oauth-start', {});
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
        'Disconnect Google Ads? Portal Analytics → Ads will stop until you reconnect.',
      )
    ) {
      return;
    }
    setBusy('disconnect');
    setBanner('');
    try {
      const resp = await authedFetch('/.netlify/functions/google-ads-oauth-disconnect', {});
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Disconnect failed');
      setBanner('Google Ads disconnected.');
      await refresh();
    } catch (err) {
      setBanner(err?.message || String(err));
    } finally {
      setBusy('');
    }
  };

  if (!canManage) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-[32px] p-6 sm:p-8 shadow-sm space-y-5">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-2xl bg-slate-100 flex items-center justify-center shrink-0">
          <Megaphone className="w-5 h-5 text-[#fd7414]" />
        </div>
        <div className="min-w-0">
          <h3 className="font-black text-lg text-slate-900">Google Ads</h3>
          <p className="text-sm text-slate-500 font-medium mt-1">
            Connect an Ignite Google account with access to client Ads accounts (usually via MCC).
            Requires a developer token in Netlify env. Portal Analytics → Ads shows spend and
            campaign performance for the billing period.
          </p>
        </div>
      </div>

      {banner ? (
        <p className="text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
          {banner}
        </p>
      ) : null}

      {status.loading ? (
        <p className="text-sm font-bold text-slate-400">Checking connection…</p>
      ) : status.connected ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 px-4 py-3 text-sm">
            <p className="font-black text-emerald-800">
              Connected as {status.adsEmail || 'Google account'}
            </p>
            {status.connectedAt ? (
              <p className="text-xs font-medium text-emerald-700/80 mt-1">
                Since {formatWhen(status.connectedAt)}
                {status.connectedByEmail ? ` · by ${status.connectedByEmail}` : ''}
              </p>
            ) : null}
          </div>

          {customers.length > 0 ? (
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                Accessible customer IDs ({customers.length})
              </p>
              <ul className="max-h-48 overflow-y-auto rounded-2xl border border-slate-100 divide-y divide-slate-50 text-sm">
                {customers.slice(0, 40).map((c) => (
                  <li key={c.customerId} className="px-4 py-2.5 flex justify-between gap-3">
                    <span className="font-bold text-slate-800 truncate">
                      {c.descriptiveName || c.customerId}
                    </span>
                    <span className="font-mono text-xs font-bold text-slate-500 shrink-0">
                      {c.customerId}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-[10px] font-bold text-slate-400 mt-2">
                Copy a customer ID into the client’s CRM field “Google Ads customer ID”.
              </p>
            </div>
          ) : (
            <p className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
              No Ads customers listed yet. Confirm the developer token, MCC login-customer-id, and
              that this Google account can access client accounts — then refresh.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={refresh}
              disabled={!!busy}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black uppercase tracking-widest"
            >
              Refresh list
            </button>
            <button
              type="button"
              onClick={disconnect}
              disabled={!!busy}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-black uppercase tracking-widest"
            >
              <Unlink className="w-3.5 h-3.5" />
              {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {status.error ? (
            <p className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
              {status.error}
            </p>
          ) : null}
          <button
            type="button"
            onClick={connect}
            disabled={!!busy}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#fd7414] hover:bg-[#e8680f] text-white text-xs font-black uppercase tracking-widest"
          >
            <Link2 className="w-3.5 h-3.5" />
            {busy === 'connect' ? 'Opening Google…' : 'Connect Google Ads'}
          </button>
        </div>
      )}
    </div>
  );
}

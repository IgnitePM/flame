import React, { useCallback, useEffect, useState } from 'react';
import { BarChart3, Link2, Unlink } from 'lucide-react';
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
 * Admin Config: connect company Google Analytics (GA4) for portal SEO traffic.
 */
export default function Ga4ConnectCard({ canManage = false, onTabFocus }) {
  const [status, setStatus] = useState({ loading: true, connected: false, ga4Email: '' });
  const [properties, setProperties] = useState([]);
  const [busy, setBusy] = useState('');
  const [banner, setBanner] = useState('');

  const refresh = useCallback(async () => {
    if (!canManage) {
      setStatus((s) => ({ ...s, loading: false }));
      return;
    }
    try {
      const resp = await authedFetch('/.netlify/functions/ga4-oauth-status', {});
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Status failed');
      setStatus({
        loading: false,
        connected: Boolean(data.connected),
        ga4Email: data.ga4Email || '',
        connectedAt: data.connectedAt || null,
        connectedByEmail: data.connectedByEmail || '',
      });
      if (data.connected) {
        const listResp = await authedFetch('/.netlify/functions/ga4-list-properties', {});
        const listData = await listResp.json().catch(() => ({}));
        if (listResp.ok) {
          setProperties(Array.isArray(listData.properties) ? listData.properties : []);
          setBanner('');
        } else {
          setProperties([]);
          setBanner(
            listData.error ||
              'Could not list GA4 properties. Disconnect and Connect Google Analytics again (token may have expired).',
          );
        }
      } else {
        setProperties([]);
      }
    } catch (err) {
      setStatus({
        loading: false,
        connected: false,
        ga4Email: '',
        error: err?.message || String(err),
      });
      setProperties([]);
    }
  }, [canManage]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search || '');
      const ga4 = params.get('ga4');
      if (!ga4) return;
      onTabFocus?.();
      if (ga4 === 'connected') {
        setBanner('Google Analytics connected. Link each client to a GA4 property ID in their profile.');
      } else if (ga4 === 'error') {
        setBanner(params.get('ga4Msg') || 'GA4 connect failed.');
      }
      params.delete('ga4');
      params.delete('ga4Msg');
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
      const resp = await authedFetch('/.netlify/functions/ga4-oauth-start', {});
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
        'Disconnect Google Analytics? Portal SEO traffic (all sources) will stop until you reconnect.',
      )
    ) {
      return;
    }
    setBusy('disconnect');
    setBanner('');
    try {
      const resp = await authedFetch('/.netlify/functions/ga4-oauth-disconnect', {});
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Disconnect failed');
      setBanner('Google Analytics disconnected.');
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
          <BarChart3 className="w-5 h-5 text-[#fd7414]" />
        </div>
        <div className="min-w-0">
          <h3 className="font-black text-lg text-slate-900">Google Analytics (GA4)</h3>
          <p className="text-sm text-slate-500 font-medium mt-1">
            Connect an Ignite Google account that has Viewer access to client GA4 properties.
            Portal SEO tabs can then show sessions and traffic sources for the billing period.
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
            <p className="font-black text-emerald-800">Connected as {status.ga4Email || 'Google account'}</p>
            {status.connectedAt ? (
              <p className="text-xs font-medium text-emerald-700/80 mt-1">
                Since {formatWhen(status.connectedAt)}
                {status.connectedByEmail ? ` · by ${status.connectedByEmail}` : ''}
              </p>
            ) : null}
          </div>

          {properties.length > 0 ? (
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                Properties visible to this account ({properties.length})
              </p>
              <ul className="max-h-48 overflow-y-auto rounded-2xl border border-slate-100 divide-y divide-slate-50 text-sm">
                {properties.slice(0, 40).map((p) => (
                  <li key={p.propertyId} className="px-4 py-2.5 flex justify-between gap-3">
                    <span className="font-bold text-slate-800 truncate">
                      {p.displayName}
                      <span className="block text-[10px] font-medium text-slate-400">
                        {p.accountName}
                      </span>
                    </span>
                    <span className="font-mono text-xs font-bold text-slate-500 shrink-0">
                      {p.propertyId}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-[10px] font-bold text-slate-400 mt-2">
                Copy a property ID into the client’s CRM profile field “GA4 property ID”.
              </p>
            </div>
          ) : (
            <p className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
              No GA4 properties returned for this Google account. If this used to work, click
              Disconnect then Connect again. Also confirm this account is a Viewer on each client’s
              GA4 property, and that the Analytics Admin API is enabled in Google Cloud.
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
            {busy === 'connect' ? 'Opening Google…' : 'Connect Google Analytics'}
          </button>
        </div>
      )}
    </div>
  );
}

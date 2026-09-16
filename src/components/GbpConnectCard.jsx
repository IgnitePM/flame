import React, { useCallback, useEffect, useState } from 'react';
import { MapPin, Link2, Unlink } from 'lucide-react';
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
 * Admin Config: connect company Google Business Profile for portal Local SEO.
 */
export default function GbpConnectCard({ canManage = false, onTabFocus }) {
  const [status, setStatus] = useState({ loading: true, connected: false, gbpEmail: '' });
  const [locations, setLocations] = useState([]);
  const [busy, setBusy] = useState('');
  const [banner, setBanner] = useState('');

  const refresh = useCallback(async () => {
    if (!canManage) {
      setStatus((s) => ({ ...s, loading: false }));
      return;
    }
    try {
      const resp = await authedFetch('/.netlify/functions/gbp-oauth-status', {});
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Status failed');
      setStatus({
        loading: false,
        connected: Boolean(data.connected),
        gbpEmail: data.gbpEmail || '',
        connectedAt: data.connectedAt || null,
        connectedByEmail: data.connectedByEmail || '',
      });
      if (data.connected) {
        const listResp = await authedFetch('/.netlify/functions/gbp-list-locations', {});
        const listData = await listResp.json().catch(() => ({}));
        if (listResp.ok) {
          setLocations(Array.isArray(listData.locations) ? listData.locations : []);
          setBanner('');
        } else {
          setLocations([]);
          setBanner(
            listData.error ||
              'Could not list Business Profile locations. Disconnect and Connect again (token may have expired), and confirm GBP APIs are enabled / approved in Google Cloud.',
          );
        }
      } else {
        setLocations([]);
      }
    } catch (err) {
      setStatus({
        loading: false,
        connected: false,
        gbpEmail: '',
        error: err?.message || String(err),
      });
      setLocations([]);
    }
  }, [canManage]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search || '');
      const gbp = params.get('gbp');
      if (!gbp) return;
      onTabFocus?.();
      if (gbp === 'connected') {
        setBanner(
          'Google Business Profile connected. Copy each location ID into the client CRM field “GBP location ID”.',
        );
      } else if (gbp === 'error') {
        setBanner(params.get('gbpMsg') || 'GBP connect failed.');
      }
      params.delete('gbp');
      params.delete('gbpMsg');
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
      const resp = await authedFetch('/.netlify/functions/gbp-oauth-start', {});
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
        'Disconnect Google Business Profile? Portal Local SEO metrics will stop until you reconnect.',
      )
    ) {
      return;
    }
    setBusy('disconnect');
    setBanner('');
    try {
      const resp = await authedFetch('/.netlify/functions/gbp-oauth-disconnect', {});
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Disconnect failed');
      setBanner('Google Business Profile disconnected.');
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
          <MapPin className="w-5 h-5 text-[#fd7414]" />
        </div>
        <div className="min-w-0">
          <h3 className="font-black text-lg text-slate-900">Google Business Profile</h3>
          <p className="text-sm text-slate-500 font-medium mt-1">
            Connect an Ignite Google account that manages client Business Profiles. Portal
            Analytics → Website → Local SEO can then show searches, maps views, calls, and more.
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
              Connected as {status.gbpEmail || 'Google account'}
            </p>
            {status.connectedAt ? (
              <p className="text-xs font-medium text-emerald-700/80 mt-1">
                Since {formatWhen(status.connectedAt)}
                {status.connectedByEmail ? ` · by ${status.connectedByEmail}` : ''}
              </p>
            ) : null}
          </div>

          {locations.length > 0 ? (
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                Locations visible to this account ({locations.length})
              </p>
              <ul className="max-h-48 overflow-y-auto rounded-2xl border border-slate-100 divide-y divide-slate-50 text-sm">
                {locations.slice(0, 60).map((loc) => (
                  <li
                    key={loc.locationId}
                    className="px-4 py-2.5 flex justify-between gap-3"
                  >
                    <span className="font-bold text-slate-800 truncate">
                      {loc.displayName}
                      <span className="block text-[10px] font-medium text-slate-400">
                        {loc.accountName}
                        {loc.address ? ` · ${loc.address}` : ''}
                      </span>
                    </span>
                    <span className="font-mono text-xs font-bold text-slate-500 shrink-0">
                      {loc.locationId}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-[10px] font-bold text-slate-400 mt-2">
                Copy a location ID into the client’s CRM profile field “GBP location ID”.
              </p>
            </div>
          ) : (
            <p className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
              No locations returned. Confirm this Google account manages the client profiles, that
              Business Profile APIs are enabled (and API access approved if required), then
              Disconnect and Connect again.
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
            {busy === 'connect' ? 'Opening Google…' : 'Connect Google Business Profile'}
          </button>
        </div>
      )}
    </div>
  );
}

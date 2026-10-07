import React, { useCallback, useEffect, useState } from 'react';
import { Link2, Receipt, Unlink } from 'lucide-react';
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
 * Admin Config: connect Ignite's QuickBooks Online company so the portal can
 * show each linked client's invoices, balance, and payments.
 */
export default function QuickBooksConnectCard({ canManage = false, onTabFocus }) {
  const [status, setStatus] = useState({ loading: true, connected: false });
  const [busy, setBusy] = useState('');
  const [banner, setBanner] = useState('');

  const refresh = useCallback(async () => {
    if (!canManage) {
      setStatus((s) => ({ ...s, loading: false }));
      return;
    }
    try {
      const resp = await authedFetch('/.netlify/functions/quickbooks-oauth-status', {});
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Status failed');
      setStatus({
        loading: false,
        connected: Boolean(data.connected),
        companyName: data.companyName || '',
        realmId: data.realmId || '',
        environment: data.environment || '',
        connectedAt: data.connectedAt || null,
        connectedByEmail: data.connectedByEmail || '',
      });
    } catch (err) {
      setStatus({
        loading: false,
        connected: false,
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
      const qbo = params.get('qbo');
      if (!qbo) return;
      onTabFocus?.();
      if (qbo === 'connected') {
        setBanner(
          'QuickBooks connected. Link each client to a QuickBooks customer on their CRM profile.',
        );
      } else if (qbo === 'error') {
        setBanner(params.get('qboMsg') || 'QuickBooks connect failed.');
      }
      params.delete('qbo');
      params.delete('qboMsg');
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
      const resp = await authedFetch('/.netlify/functions/quickbooks-oauth-start', {});
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
        'Disconnect QuickBooks? The client portal Billing tab will stop until you reconnect.',
      )
    ) {
      return;
    }
    setBusy('disconnect');
    setBanner('');
    try {
      const resp = await authedFetch('/.netlify/functions/quickbooks-oauth-disconnect', {});
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Disconnect failed');
      setBanner('QuickBooks disconnected.');
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
          <Receipt className="w-5 h-5 text-[#fd7414]" />
        </div>
        <div className="min-w-0">
          <h3 className="font-black text-lg text-slate-900">QuickBooks</h3>
          <p className="text-sm text-slate-500 font-medium mt-1">
            Connect Ignite’s QuickBooks Online company once. Then link each CRM client to a
            QuickBooks customer so the portal Billing tab can show that client’s invoices, balance,
            and payments. Official invoices stay in QuickBooks.
          </p>
        </div>
      </div>

      {banner ? (
        <p className="text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
          {banner}
        </p>
      ) : null}

      {status.error ? (
        <p className="text-xs font-bold text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
          {status.error}
        </p>
      ) : null}

      {status.loading ? (
        <p className="text-sm font-bold text-slate-400">Checking connection…</p>
      ) : status.connected ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 px-4 py-3 text-sm">
            <p className="font-black text-emerald-800">
              Connected{status.companyName ? ` · ${status.companyName}` : ''}
            </p>
            <p className="text-xs font-medium text-emerald-700/80 mt-1">
              {status.environment === 'sandbox' ? 'Sandbox company' : 'Production company'}
              {status.realmId ? ` · company id ${status.realmId}` : ''}
              {status.connectedAt ? ` · since ${formatWhen(status.connectedAt)}` : ''}
              {status.connectedByEmail ? ` · by ${status.connectedByEmail}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={disconnect}
            disabled={!!busy}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-50"
          >
            <Unlink className="w-3.5 h-3.5" />
            {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <button
            type="button"
            onClick={connect}
            disabled={!!busy}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest bg-black text-white disabled:opacity-50"
          >
            <Link2 className="w-3.5 h-3.5" />
            {busy === 'connect' ? 'Opening QuickBooks…' : 'Connect QuickBooks'}
          </button>
          <p className="text-[10px] font-bold text-slate-400 leading-relaxed">
            Needs an Intuit app with keys in Netlify: QUICKBOOKS_CLIENT_ID,
            QUICKBOOKS_CLIENT_SECRET, and QUICKBOOKS_OAUTH_REDIRECT_URI pointing at
            /.netlify/functions/quickbooks-oauth-callback. Use production keys for the live
            company, or set QUICKBOOKS_ENVIRONMENT=sandbox with development keys.
          </p>
        </div>
      )}
    </div>
  );
}

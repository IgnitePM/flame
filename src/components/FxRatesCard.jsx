import React, { useState } from 'react';
import { authedFetch } from '../utils/authedFetch.js';
import { FALLBACK_FX_TO_CAD } from '../utils/fxToCad.js';

/**
 * Shows live FX → CAD rates used for expenses / Perplexity credits.
 * Rates refresh daily from ECB (Frankfurter); admins/billing can refresh now.
 */
export default function FxRatesCard({ fxRatesDoc, canRefresh = false }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rates = {
    ...FALLBACK_FX_TO_CAD,
    ...(fxRatesDoc?.rates || {}),
    CAD: 1,
  };
  const asOf = fxRatesDoc?.asOf || null;
  const updatedAt = Number(fxRatesDoc?.updatedAt || 0) || null;
  const usingLive = !!(fxRatesDoc?.rates?.USD);

  const refresh = async () => {
    setBusy(true);
    setError('');
    try {
      const resp = await authedFetch('/.netlify/functions/refresh-fx-rates-http', {});
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Refresh failed');
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="font-black text-xl text-slate-900">Exchange rates (→ CAD)</h3>
          <p className="text-xs font-bold text-slate-400 mt-1">
            Used for USD/EUR/GBP expenses and Perplexity credits ($0.01 USD each).
            Source: ECB reference rates via Frankfurter
            {usingLive ? ' (live cache)' : ' (fallback until first refresh)'}.
          </p>
        </div>
        {canRefresh && (
          <button
            type="button"
            disabled={busy}
            onClick={refresh}
            className="px-5 py-3 rounded-2xl font-black text-sm bg-black text-white disabled:opacity-50"
          >
            {busy ? 'Refreshing…' : 'Refresh now'}
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {['USD', 'EUR', 'GBP', 'CAD'].map((code) => (
          <div
            key={code}
            className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3"
          >
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              1 {code}
            </div>
            <div className="font-black text-lg text-slate-900">
              ${Number(rates[code] || 0).toFixed(4)} CAD
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] font-bold text-slate-500">
        {asOf ? `ECB as-of ${asOf}` : 'No live as-of date yet'}
        {updatedAt
          ? ` · cached ${new Date(updatedAt).toLocaleString()}`
          : ''}
      </p>
      {error ? (
        <p className="text-sm font-bold text-red-600">{error}</p>
      ) : null}
    </div>
  );
}

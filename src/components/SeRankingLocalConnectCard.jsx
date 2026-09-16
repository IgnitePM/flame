import React, { useCallback, useEffect, useState } from 'react';
import { MapPin, RefreshCw } from 'lucide-react';
import { authedFetch } from '../utils/authedFetch.js';

/**
 * Admin Config: list SE Ranking Local Marketing locations for CRM linking.
 * Uses existing SE_RANKING_API_KEY (no Google GBP OAuth required).
 */
export default function SeRankingLocalConnectCard({ canManage = false }) {
  const [loading, setLoading] = useState(true);
  const [locations, setLocations] = useState([]);
  const [banner, setBanner] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const resp = await authedFetch(
        '/.netlify/functions/se-ranking-list-local-locations',
        {},
      );
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Could not list locations.');
      setLocations(Array.isArray(data.locations) ? data.locations : []);
      setBanner(
        data.locations?.length
          ? ''
          : 'No active Local Marketing locations found. Add locations in SE Ranking Local Marketing first.',
      );
    } catch (err) {
      setLocations([]);
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!canManage) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-[32px] p-6 sm:p-8 shadow-sm space-y-5">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-2xl bg-slate-100 flex items-center justify-center shrink-0">
          <MapPin className="w-5 h-5 text-[#fd7414]" />
        </div>
        <div className="min-w-0">
          <h3 className="font-black text-lg text-slate-900">
            SE Ranking Local Marketing
          </h3>
          <p className="text-sm text-slate-500 font-medium mt-1">
            Portal Analytics → Website → Local SEO pulls Google Business Profile metrics through
            your SE Ranking Local Marketing add-on (same API key as Project SEO). Copy a location
            ID into each client’s CRM profile.
          </p>
        </div>
      </div>

      {banner ? (
        <p className="text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
          {banner}
        </p>
      ) : null}
      {error ? (
        <p className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm font-bold text-slate-400">Loading locations…</p>
      ) : locations.length > 0 ? (
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
            Locations in Local Marketing ({locations.length})
          </p>
          <ul className="max-h-56 overflow-y-auto rounded-2xl border border-slate-100 divide-y divide-slate-50 text-sm">
            {locations.map((loc) => (
              <li
                key={loc.locationId}
                className="px-4 py-2.5 flex justify-between gap-3"
              >
                <span className="font-bold text-slate-800 truncate">
                  {loc.displayName}
                  <span className="block text-[10px] font-medium text-slate-400">
                    {[loc.accountName, loc.connectionStatus].filter(Boolean).join(' · ')}
                    {loc.averageRating != null
                      ? ` · ${Number(loc.averageRating).toFixed(1)}★`
                      : ''}
                  </span>
                </span>
                <span className="font-mono text-xs font-bold text-slate-500 shrink-0">
                  {loc.locationId}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[10px] font-bold text-slate-400 mt-2">
            Copy a location ID into the client CRM field “SE Ranking Local location ID”.
          </p>
        </div>
      ) : !error ? (
        <p className="text-xs font-bold text-slate-500">No locations to show.</p>
      ) : null}

      <button
        type="button"
        onClick={refresh}
        disabled={loading}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black uppercase tracking-widest disabled:opacity-40"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        Refresh list
      </button>
    </div>
  );
}

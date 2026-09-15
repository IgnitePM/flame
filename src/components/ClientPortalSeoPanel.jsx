import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  LineChart,
  Loader2,
  Minus,
  RefreshCw,
} from 'lucide-react';
import { authedFetch } from '../utils/authedFetch.js';

function formatDay(ymd) {
  if (!ymd) return '';
  try {
    const d = new Date(`${ymd}T12:00:00`);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return ymd;
  }
}

function Sparkline({ points, invert = false, className = '' }) {
  const values = (points || [])
    .map((p) => Number(p.value))
    .filter((n) => Number.isFinite(n));
  if (values.length < 2) {
    return (
      <div className={`h-16 flex items-center text-xs font-bold text-slate-400 ${className}`}>
        Not enough history yet
      </div>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 320;
  const h = 64;
  const coords = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const yNorm = (v - min) / span;
    const y = invert ? yNorm * (h - 8) + 4 : (1 - yNorm) * (h - 8) + 4;
    return `${x},${y}`;
  });
  const last = values[values.length - 1];
  const first = values[0];
  const improved = invert ? last < first : last > first;

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-16 overflow-visible">
        <polyline
          fill="none"
          stroke={improved ? '#10b981' : '#fd7414'}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={coords.join(' ')}
        />
      </svg>
    </div>
  );
}

function StatCard({ label, value, hint }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
        {label}
      </div>
      <div className="text-2xl font-black text-slate-900 mt-2 tabular-nums">{value}</div>
      {hint ? <div className="text-xs font-medium text-slate-500 mt-1">{hint}</div> : null}
    </div>
  );
}

/**
 * Portal SEO report panel (SE Ranking Project API via Netlify).
 */
export default function ClientPortalSeoPanel({ client, dateFromMs, dateToMs }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [report, setReport] = useState(null);

  const range = useMemo(() => {
    const from = dateFromMs
      ? new Date(dateFromMs).toISOString().slice(0, 10)
      : '';
    const to = dateToMs ? new Date(dateToMs).toISOString().slice(0, 10) : '';
    return { from, to };
  }, [dateFromMs, dateToMs]);

  const load = async () => {
    if (!client?.id) return;
    setLoading(true);
    setError('');
    try {
      const resp = await authedFetch('/.netlify/functions/portal-se-ranking', {
        clientId: client.id,
        dateFrom: range.from,
        dateTo: range.to,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `Request failed (${resp.status})`);
      setReport(data);
    } catch (err) {
      setReport(null);
      setError(err?.message || 'Could not load SEO report.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client?.id, range.from, range.to]);

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-[32px] p-12 shadow-sm flex flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="w-6 h-6 animate-spin text-[#fd7414]" />
        <p className="text-sm font-bold">Loading ranking report…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white border border-slate-200 rounded-[32px] p-8 sm:p-10 shadow-sm space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-slate-100 flex items-center justify-center">
            <LineChart className="w-5 h-5 text-[#fd7414]" />
          </div>
          <div>
            <h3 className="font-black text-xl text-slate-900">SEO rankings</h3>
            <p className="text-sm text-slate-500 font-medium">SE Ranking performance</p>
          </div>
        </div>
        <p className="text-sm font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3">
          {error}
        </p>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-widest"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    );
  }

  const p = report?.project || {};
  const visTrend = report?.visibilityTrend || [];
  const posTrend = report?.avgPositionTrend || [];
  const keywords = report?.keywords || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-slate-900">SEO rankings</h2>
          <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] mt-1">
            {p.title || p.domain || 'SE Ranking'} · {formatDay(report.dateFrom)} –{' '}
            {formatDay(report.dateTo)}
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black uppercase tracking-widest"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Visibility"
          value={
            p.visibilityPercent != null ? `${Number(p.visibilityPercent).toFixed(1)}%` : '—'
          }
        />
        <StatCard
          label="Avg position"
          value={p.todayAvg != null ? Number(p.todayAvg).toFixed(1) : '—'}
          hint={
            p.yesterdayAvg != null
              ? `Prev check ${Number(p.yesterdayAvg).toFixed(1)}`
              : undefined
          }
        />
        <StatCard label="Top 10 keywords" value={p.top10 ?? 0} />
        <StatCard
          label="Movers"
          value={
            <span className="inline-flex items-center gap-3">
              <span className="text-emerald-600 inline-flex items-center gap-1">
                <ArrowUpRight className="w-5 h-5" />
                {p.totalUp ?? 0}
              </span>
              <span className="text-rose-500 inline-flex items-center gap-1">
                <ArrowDownRight className="w-5 h-5" />
                {p.totalDown ?? 0}
              </span>
            </span>
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-[28px] p-6 shadow-sm">
          <h3 className="font-black text-slate-900 mb-1">Visibility trend</h3>
          <p className="text-xs text-slate-500 font-medium mb-4">
            Higher is better · this reporting period
          </p>
          <Sparkline points={visTrend} />
        </div>
        <div className="bg-white border border-slate-200 rounded-[28px] p-6 shadow-sm">
          <h3 className="font-black text-slate-900 mb-1">Average position trend</h3>
          <p className="text-xs text-slate-500 font-medium mb-4">
            Lower is better · this reporting period
          </p>
          <Sparkline points={posTrend} invert />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-[28px] shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between gap-3">
          <div>
            <h3 className="font-black text-slate-900">Keyword rankings</h3>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Best position across tracked engines · top {keywords.length}
            </p>
          </div>
        </div>
        {keywords.length === 0 ? (
          <p className="p-8 text-sm font-bold text-slate-400">No keyword data for this range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
                  <th className="px-6 py-3">Keyword</th>
                  <th className="px-4 py-3">Pos</th>
                  <th className="px-4 py-3">Change</th>
                  <th className="px-4 py-3">Volume</th>
                  <th className="px-6 py-3">Checked</th>
                </tr>
              </thead>
              <tbody>
                {keywords.map((row) => {
                  const change = Number(row.change) || 0;
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-slate-50 last:border-0 hover:bg-slate-50/80"
                    >
                      <td className="px-6 py-3 font-bold text-slate-800 max-w-[280px] truncate">
                        {row.name}
                      </td>
                      <td className="px-4 py-3 font-black tabular-nums text-slate-900">
                        {row.position > 0 ? row.position : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {change > 0 ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600 font-bold">
                            <ArrowUpRight className="w-3.5 h-3.5" />+{change}
                          </span>
                        ) : change < 0 ? (
                          <span className="inline-flex items-center gap-1 text-rose-500 font-bold">
                            <ArrowDownRight className="w-3.5 h-3.5" />
                            {change}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-slate-400 font-bold">
                            <Minus className="w-3.5 h-3.5" />0
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-600 font-medium">
                        {row.volume ? row.volume.toLocaleString() : '—'}
                      </td>
                      <td className="px-6 py-3 text-slate-500 font-medium">
                        {formatDay(row.date)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

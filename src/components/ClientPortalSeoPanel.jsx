import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  LayoutDashboard,
  LineChart,
  Loader2,
  Minus,
  MousePointerClick,
  RefreshCw,
  Search,
  TrendingUp,
} from 'lucide-react';
import { authedFetch } from '../utils/authedFetch.js';

const SEO_TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'traffic', label: 'Website Traffic', icon: TrendingUp },
  { id: 'gsc', label: 'Search Console', icon: MousePointerClick },
  { id: 'keywords', label: 'Keyword Rankings', icon: Search },
];

function formatDay(ymd) {
  if (!ymd) return '';
  try {
    const d = new Date(`${ymd}T12:00:00`);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return ymd;
  }
}

function formatNum(n, digits = 0) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
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

function WowBadge({ delta, digits = 1, invert = false, suffix = '' }) {
  if (delta == null || !Number.isFinite(Number(delta))) {
    return <span className="text-slate-400 font-bold text-xs">WoW n/a</span>;
  }
  const n = Number(delta);
  const improved = invert ? n < 0 : n > 0;
  const declined = invert ? n > 0 : n < 0;
  const abs = Math.abs(n);
  const label = `${n > 0 ? '+' : ''}${abs.toFixed(digits)}${suffix}`;
  if (Math.abs(n) < 0.05) {
    return (
      <span className="inline-flex items-center gap-1 text-slate-400 font-bold text-xs">
        <Minus className="w-3.5 h-3.5" /> WoW flat
      </span>
    );
  }
  if (improved) {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-600 font-bold text-xs">
        <ArrowUpRight className="w-3.5 h-3.5" /> WoW {label}
      </span>
    );
  }
  if (declined) {
    return (
      <span className="inline-flex items-center gap-1 text-rose-500 font-bold text-xs">
        <ArrowDownRight className="w-3.5 h-3.5" /> WoW {label}
      </span>
    );
  }
  return <span className="text-slate-400 font-bold text-xs">WoW {label}</span>;
}

function PositionDelta({ delta }) {
  if (delta == null || !Number.isFinite(Number(delta))) {
    return <span className="text-slate-300 font-bold">—</span>;
  }
  const n = Number(delta);
  if (n > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-600 font-bold">
        <ArrowUpRight className="w-3.5 h-3.5" />+{n}
      </span>
    );
  }
  if (n < 0) {
    return (
      <span className="inline-flex items-center gap-1 text-rose-500 font-bold">
        <ArrowDownRight className="w-3.5 h-3.5" />
        {n}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-slate-400 font-bold">
      <Minus className="w-3.5 h-3.5" />0
    </span>
  );
}

/**
 * Portal SEO report panel (SE Ranking Project API via Netlify).
 */
export default function ClientPortalSeoPanel({ client, dateFromMs, dateToMs }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [report, setReport] = useState(null);
  const [seoTab, setSeoTab] = useState('overview');

  const range = useMemo(() => {
    const from = dateFromMs
      ? new Date(dateFromMs).toISOString().slice(0, 10)
      : '';
    const to = dateToMs ? new Date(dateToMs).toISOString().slice(0, 10) : '';
    return { from, to };
  }, [dateFromMs, dateToMs]);

  const load = async ({ forceRefresh = false } = {}) => {
    if (!client?.id) return;
    setLoading(true);
    setError('');
    try {
      const resp = await authedFetch('/.netlify/functions/portal-se-ranking', {
        clientId: client.id,
        dateFrom: range.from,
        dateTo: range.to,
        ...(forceRefresh ? { forceRefresh: true } : {}),
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
          onClick={() => load({ forceRefresh: true })}
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
  const wow = report?.weekOverWeek || {};
  const traffic = report?.traffic || {};
  const analytics = report?.analytics || {};

  const formatDuration = (seconds) => {
    const s = Math.round(Number(seconds) || 0);
    if (!s) return '—';
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m > 0 ? `${m}m ${r}s` : `${r}s`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-slate-900">SEO</h2>
          <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] mt-1">
            {p.title || p.domain || 'SE Ranking'} · {formatDay(report.dateFrom)} –{' '}
            {formatDay(report.dateTo)}
            {report?.cached
              ? ` · Cached${
                  report.cacheAgeSec
                    ? ` ${Math.max(1, Math.round(report.cacheAgeSec / 60))}m ago`
                    : ''
                }`
              : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => load({ forceRefresh: true })}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black uppercase tracking-widest"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {SEO_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSeoTab(tab.id)}
            className={`shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
              seoTab === tab.id
                ? 'bg-[#fd7414] text-white shadow-sm'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {seoTab === 'overview' ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              label="Visibility"
              value={
                p.visibilityPercent != null
                  ? `${Number(p.visibilityPercent).toFixed(1)}%`
                  : '—'
              }
              hint={<WowBadge delta={wow.visibility?.delta} digits={1} suffix=" pts" />}
            />
            <StatCard
              label="Avg position"
              value={p.todayAvg != null ? Number(p.todayAvg).toFixed(1) : '—'}
              hint={<WowBadge delta={wow.avgPosition?.delta} digits={1} invert />}
            />
            <StatCard label="Top 10 keywords" value={p.top10 ?? 0} />
            <StatCard
              label="Week-over-week"
              value={
                <span className="inline-flex items-center gap-3 text-lg">
                  <span className="text-emerald-600 inline-flex items-center gap-1">
                    <ArrowUpRight className="w-5 h-5" />
                    {wow.keywordsImproved ?? 0}
                  </span>
                  <span className="text-rose-500 inline-flex items-center gap-1">
                    <ArrowDownRight className="w-5 h-5" />
                    {wow.keywordsDeclined ?? 0}
                  </span>
                </span>
              }
              hint="Keywords up / down vs ~7 days ago"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white border border-slate-200 rounded-[28px] p-6 shadow-sm">
              <div className="flex items-start justify-between gap-3 mb-1">
                <div>
                  <h3 className="font-black text-slate-900">Visibility trend</h3>
                  <p className="text-xs text-slate-500 font-medium mt-1">
                    Higher is better · this reporting period
                  </p>
                </div>
                <WowBadge delta={wow.visibility?.delta} digits={1} suffix=" pts" />
              </div>
              <Sparkline points={visTrend} className="mt-4" />
              {wow.visibility?.priorDate ? (
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-3">
                  WoW: {formatDay(wow.visibility.priorDate)} →{' '}
                  {formatDay(wow.visibility.currentDate)}
                </p>
              ) : null}
            </div>
            <div className="bg-white border border-slate-200 rounded-[28px] p-6 shadow-sm">
              <div className="flex items-start justify-between gap-3 mb-1">
                <div>
                  <h3 className="font-black text-slate-900">Average position trend</h3>
                  <p className="text-xs text-slate-500 font-medium mt-1">
                    Lower is better · this reporting period
                  </p>
                </div>
                <WowBadge delta={wow.avgPosition?.delta} digits={1} invert />
              </div>
              <Sparkline points={posTrend} invert className="mt-4" />
              {wow.avgPosition?.priorDate ? (
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-3">
                  WoW: {formatDay(wow.avgPosition.priorDate)} →{' '}
                  {formatDay(wow.avgPosition.currentDate)}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {seoTab === 'traffic' ? (
        <div className="bg-white border border-slate-200 rounded-[28px] p-6 shadow-sm space-y-5">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl bg-slate-100 flex items-center justify-center shrink-0">
              <TrendingUp className="w-5 h-5 text-[#fd7414]" />
            </div>
            <div>
              <h3 className="font-black text-slate-900">Website traffic (all sources)</h3>
              <p className="text-xs text-slate-500 font-medium mt-1">
                Google Analytics 4 · sessions by channel for this reporting period
              </p>
            </div>
          </div>

          {!analytics.available ? (
            <p className="text-sm font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3">
              {analytics.warning || 'Google Analytics data is not available yet.'}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard label="Sessions" value={formatNum(analytics.sessions)} />
                <StatCard label="Users" value={formatNum(analytics.users)} />
                <StatCard label="New users" value={formatNum(analytics.newUsers)} />
                <StatCard
                  label="Engagement rate"
                  value={
                    analytics.engagementRate != null
                      ? `${Number(analytics.engagementRate).toFixed(1)}%`
                      : '—'
                  }
                  hint={
                    analytics.avgSessionDuration != null
                      ? `Avg session ${formatDuration(analytics.avgSessionDuration)}`
                      : undefined
                  }
                />
              </div>
              {Array.isArray(analytics.channels) && analytics.channels.length > 0 ? (
                <div className="space-y-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    Traffic sources
                  </p>
                  <ul className="space-y-2">
                    {analytics.channels.map((ch) => (
                      <li key={ch.channel}>
                        <div className="flex items-center justify-between gap-3 text-sm mb-1">
                          <span className="font-bold text-slate-800">{ch.channel}</span>
                          <span className="tabular-nums font-black text-slate-900">
                            {formatNum(ch.sessions)}
                            <span className="text-slate-400 font-bold text-xs ml-2">
                              {Number(ch.share || 0).toFixed(0)}%
                            </span>
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-[#fd7414]"
                            style={{
                              width: `${Math.min(100, Math.max(2, Number(ch.share) || 0))}%`,
                            }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {seoTab === 'gsc' ? (
        <div className="bg-white border border-slate-200 rounded-[28px] p-6 shadow-sm space-y-5">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl bg-slate-100 flex items-center justify-center shrink-0">
              <MousePointerClick className="w-5 h-5 text-[#fd7414]" />
            </div>
            <div>
              <h3 className="font-black text-slate-900">Google Search Console</h3>
              <p className="text-xs text-slate-500 font-medium mt-1">
                Organic search queries via SE Ranking (not all-site traffic)
              </p>
            </div>
          </div>

          {traffic.warning && !traffic.clicks && traffic.source !== 'seo_potential' ? (
            <p className="text-sm font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3">
              {traffic.warning}
              {traffic.estimatedTraffic != null ? (
                <span className="block mt-2 text-slate-600 font-medium">
                  Estimated organic traffic potential:{' '}
                  <span className="font-black text-slate-900">
                    {formatNum(traffic.estimatedTraffic)}
                  </span>
                  {traffic.estimatedTrafficValue != null ? (
                    <>
                      {' '}
                      · est. value ${formatNum(traffic.estimatedTrafficValue, 0)}
                    </>
                  ) : null}
                </span>
              ) : null}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard label="Clicks" value={formatNum(traffic.clicks)} />
                <StatCard label="Impressions" value={formatNum(traffic.impressions)} />
                <StatCard
                  label="Avg CTR"
                  value={
                    traffic.avgCtr != null ? `${Number(traffic.avgCtr).toFixed(1)}%` : '—'
                  }
                />
                <StatCard
                  label="GSC avg position"
                  value={
                    traffic.avgPosition != null
                      ? Number(traffic.avgPosition).toFixed(1)
                      : '—'
                  }
                />
              </div>
              {traffic.estimatedTraffic != null ? (
                <p className="text-xs font-medium text-slate-500 flex items-center gap-2">
                  <TrendingUp className="w-3.5 h-3.5 text-[#fd7414]" />
                  SE Ranking estimated traffic potential:{' '}
                  <span className="font-black text-slate-800">
                    {formatNum(traffic.estimatedTraffic)}
                  </span>
                  {traffic.estimatedTrafficValue != null ? (
                    <span>· ${formatNum(traffic.estimatedTrafficValue, 0)} value</span>
                  ) : null}
                </p>
              ) : null}
              {Array.isArray(traffic.queries) && traffic.queries.length > 0 ? (
                <div className="overflow-x-auto rounded-2xl border border-slate-100">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100 bg-slate-50/80">
                        <th className="px-4 py-3">Top query</th>
                        <th className="px-3 py-3">Clicks</th>
                        <th className="px-3 py-3">Impr.</th>
                        <th className="px-3 py-3">CTR</th>
                        <th className="px-4 py-3">Avg pos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {traffic.queries.map((q) => (
                        <tr
                          key={q.query}
                          className="border-b border-slate-50 last:border-0"
                        >
                          <td className="px-4 py-2.5 font-bold text-slate-800 max-w-[260px] truncate">
                            {q.query}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums font-medium">
                            {formatNum(q.clicks)}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums font-medium text-slate-600">
                            {formatNum(q.impressions)}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums font-medium text-slate-600">
                            {Number(q.ctr || 0).toFixed(1)}%
                          </td>
                          <td className="px-4 py-2.5 tabular-nums font-medium">
                            {q.avg != null ? Number(q.avg).toFixed(1) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {seoTab === 'keywords' ? (
        <div className="bg-white border border-slate-200 rounded-[28px] shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100">
            <h3 className="font-black text-slate-900">Keyword rankings</h3>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Best position across tracked engines · WoW vs ~7 days prior · top{' '}
              {keywords.length}
            </p>
          </div>
          {keywords.length === 0 ? (
            <p className="p-8 text-sm font-bold text-slate-400">
              No keyword data for this range.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
                    <th className="px-6 py-3">Keyword</th>
                    <th className="px-4 py-3">Pos</th>
                    <th className="px-4 py-3">WoW</th>
                    <th className="px-4 py-3">Prev</th>
                    <th className="px-4 py-3">Volume</th>
                    <th className="px-6 py-3">Checked</th>
                  </tr>
                </thead>
                <tbody>
                  {keywords.map((row) => (
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
                        <PositionDelta delta={row.wowDelta} />
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-500 font-medium">
                        {row.priorPosition > 0 ? row.priorPosition : '—'}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-600 font-medium">
                        {row.volume ? row.volume.toLocaleString() : '—'}
                      </td>
                      <td className="px-6 py-3 text-slate-500 font-medium">
                        {formatDay(row.date)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

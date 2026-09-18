import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  CalendarRange,
  Globe2,
  Loader2,
  Mail,
  Megaphone,
  RefreshCw,
  Share2,
} from 'lucide-react';
import {
  clientHasActiveAdsRetainer,
  clientHasActiveEmailRetainer,
  clientHasActiveSeoRetainer,
  clientHasActiveSocialMediaRetainer,
} from '../utils/retainerCategories.js';
import { authedFetch } from '../utils/authedFetch.js';
import { getEmailMarketingProviderMeta } from '../utils/emailMarketingProvider.js';
import ClientPortalSeoPanel from './ClientPortalSeoPanel.jsx';

const TABS = [
  {
    id: 'website',
    label: 'Website',
    icon: Globe2,
    gate: clientHasActiveSeoRetainer,
    disabledTitle: 'Available with an active SEO retainer',
  },
  {
    id: 'email',
    label: 'Email',
    icon: Mail,
    gate: clientHasActiveEmailRetainer,
    disabledTitle: 'Available with an active Email Marketing retainer',
  },
  {
    id: 'social',
    label: 'Social Media',
    icon: Share2,
    gate: clientHasActiveSocialMediaRetainer,
    disabledTitle: 'Available with an active Social Media retainer',
  },
  {
    id: 'ads',
    label: 'Ads',
    icon: Megaphone,
    gate: clientHasActiveAdsRetainer,
    disabledTitle: 'Available with an active Ads / Social Ad Budget retainer',
  },
];

function startOfLocalDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function endOfLocalDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x.getTime();
}

function toYmdLocal(ms) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fromYmdLocal(ymd, endOfDay = false) {
  const [y, m, d] = String(ymd || '')
    .split('-')
    .map((n) => Number(n));
  if (!y || !m || !d) return Date.now();
  const dt = new Date(y, m - 1, d);
  return endOfDay ? endOfLocalDay(dt) : startOfLocalDay(dt);
}

function daysAgoStart(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return startOfLocalDay(d);
}

const PRESETS = [
  { id: 'billing', label: 'This billing cycle' },
  { id: '7d', label: 'Past week' },
  { id: '30d', label: 'Past month' },
  { id: '90d', label: 'Past 90 days' },
  { id: '365d', label: 'Past year' },
  { id: 'custom', label: 'Custom' },
];

function resolvePresetRange(presetId, billingFromMs, billingToMs, customFrom, customTo) {
  const nowEnd = endOfLocalDay(new Date());
  switch (presetId) {
    case '7d':
      return { fromMs: daysAgoStart(7), toMs: nowEnd };
    case '30d':
      return { fromMs: daysAgoStart(30), toMs: nowEnd };
    case '90d':
      return { fromMs: daysAgoStart(90), toMs: nowEnd };
    case '365d':
      return { fromMs: daysAgoStart(365), toMs: nowEnd };
    case 'custom': {
      const fromMs = fromYmdLocal(customFrom, false);
      const toMs = fromYmdLocal(customTo, true);
      if (fromMs > toMs) return { fromMs: toMs, toMs: fromMs };
      return { fromMs, toMs };
    }
    case 'billing':
    default:
      return {
        fromMs: Number(billingFromMs) || daysAgoStart(30),
        toMs: Number(billingToMs) || nowEnd,
      };
  }
}

function formatDay(ymd) {
  if (!ymd) return '';
  try {
    return new Date(`${ymd}T12:00:00`).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return ymd;
  }
}

function cacheSubtitleSuffix(report) {
  if (!report?.cached) return '';
  const mins = report.cacheAgeSec
    ? Math.max(1, Math.round(Number(report.cacheAgeSec) / 60))
    : null;
  return mins ? ` · Cached ${mins}m ago` : ' · Cached';
}

function formatNum(n, digits = 0) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function formatMoney(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return `$${Number(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
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

function PanelShell({ title, subtitle, onRefresh, loading, children }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h3 className="font-black text-xl text-slate-900">{title}</h3>
          {subtitle ? (
            <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] mt-1">
              {subtitle}
            </p>
          ) : null}
        </div>
        {onRefresh ? (
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black uppercase tracking-widest disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function useAnalyticsReport(endpoint, clientId, dateFromMs, dateToMs, enabled) {
  const [loading, setLoading] = useState(Boolean(enabled));
  const [error, setError] = useState('');
  const [report, setReport] = useState(null);

  const range = useMemo(() => {
    const from = dateFromMs ? new Date(dateFromMs).toISOString().slice(0, 10) : '';
    const to = dateToMs ? new Date(dateToMs).toISOString().slice(0, 10) : '';
    return { from, to };
  }, [dateFromMs, dateToMs]);

  const load = async ({ forceRefresh = false } = {}) => {
    if (!enabled || !clientId) return;
    setLoading(true);
    setError('');
    try {
      const resp = await authedFetch(endpoint, {
        clientId,
        dateFrom: range.from,
        dateTo: range.to,
        ...(forceRefresh ? { forceRefresh: true } : {}),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `Request failed (${resp.status})`);
      setReport(data);
    } catch (err) {
      setReport(null);
      setError(err?.message || 'Could not load report.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setReport(null);
      setError('');
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, clientId, range.from, range.to, endpoint]);

  return {
    loading,
    error,
    report,
    load: () => load({ forceRefresh: true }),
    range,
  };
}

function EmailAnalyticsPanel({ client, dateFromMs, dateToMs }) {
  const providerMeta = getEmailMarketingProviderMeta(client?.emailMarketingProvider);
  const { loading, error, report, load, range } = useAnalyticsReport(
    providerMeta.endpoint,
    client?.id,
    dateFromMs,
    dateToMs,
    true,
  );

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-[28px] p-12 shadow-sm flex flex-col items-center gap-3 text-slate-500">
        <Loader2 className="w-6 h-6 animate-spin text-[#fd7414]" />
        <p className="text-sm font-bold">Loading email analytics…</p>
      </div>
    );
  }

  if (error) {
    return (
      <PanelShell title="Email" onRefresh={load} loading={loading}>
        <p className="text-sm font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3">
          {error}
        </p>
      </PanelShell>
    );
  }

  const audience = report?.audience || {};
  const campaigns = Array.isArray(report?.campaigns) ? report.campaigns : [];
  const totals = report?.totals || {};
  const growth = Array.isArray(report?.growth) ? report.growth : [];
  const availableAudiences = Array.isArray(report?.availableAudiences)
    ? report.availableAudiences
    : [];
  const isMailchimp = providerMeta.id === 'mailchimp';

  return (
    <PanelShell
      title="Email"
      subtitle={`${providerMeta.label} · ${formatDay(range.from)} – ${formatDay(range.to)}${cacheSubtitleSuffix(report)}`}
      onRefresh={load}
      loading={loading}
    >
      {report?.warning ? (
        <div className="space-y-3">
          <p className="text-sm font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3">
            {report.warning}
          </p>
          {isMailchimp && availableAudiences.length > 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-4 text-sm">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                Audiences on this Mailchimp account
              </p>
              <ul className="space-y-1.5">
                {availableAudiences.map((a) => (
                  <li key={a.id} className="flex justify-between gap-3">
                    <span className="font-bold text-slate-800">{a.name}</span>
                    <span className="font-mono text-xs font-bold text-slate-500">{a.id}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[10px] font-bold text-slate-400 mt-2">
                Copy the correct ID into the client CRM field “Mailchimp audience ID”.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {report?.available === false && !report?.warning ? (
        <p className="text-sm font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3">
          Email analytics are not available yet.
        </p>
      ) : null}

      {report?.available !== false || campaigns.length > 0 ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Audience size" value={formatNum(audience.memberCount)} />
            <StatCard label="Campaigns sent" value={formatNum(totals.campaigns)} />
            <StatCard label="Emails sent" value={formatNum(totals.emailsSent)} />
            <StatCard
              label="Avg open rate"
              value={
                totals.avgOpenRate != null
                  ? `${(Number(totals.avgOpenRate) * 100).toFixed(1)}%`
                  : '—'
              }
            />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              label="Avg click rate"
              value={
                totals.avgClickRate != null
                  ? `${(Number(totals.avgClickRate) * 100).toFixed(1)}%`
                  : '—'
              }
            />
            <StatCard label="Unique opens" value={formatNum(totals.uniqueOpens)} />
            <StatCard label="Unique clicks" value={formatNum(totals.uniqueClicks)} />
            <StatCard label="Unsubscribes" value={formatNum(totals.unsubscribes)} />
          </div>

          {growth.length > 0 ? (
            <div className="bg-white border border-slate-200 rounded-[28px] shadow-sm overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-100">
                <h4 className="font-black text-slate-900">Audience growth</h4>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  Monthly subscribed vs unsubscribed (last {growth.length} months)
                </p>
              </div>
              <div className="overflow-x-auto no-scrollbar">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
                      <th className="px-6 py-3">Month</th>
                      <th className="px-4 py-3">Subscribed</th>
                      <th className="px-4 py-3">Unsubscribed</th>
                      <th className="px-4 py-3">Cleaned</th>
                      <th className="px-6 py-3">Existing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {growth.map((g) => (
                      <tr key={g.month} className="border-b border-slate-50 last:border-0">
                        <td className="px-6 py-3 font-bold text-slate-800">{g.month}</td>
                        <td className="px-4 py-3 tabular-nums font-medium text-emerald-700">
                          {formatNum(g.subscribed)}
                        </td>
                        <td className="px-4 py-3 tabular-nums font-medium text-rose-600">
                          {formatNum(g.unsubscribed)}
                        </td>
                        <td className="px-4 py-3 tabular-nums font-medium">
                          {formatNum(g.cleaned)}
                        </td>
                        <td className="px-6 py-3 tabular-nums font-medium">
                          {formatNum(g.existing)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="bg-white border border-slate-200 rounded-[28px] shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100">
              <h4 className="font-black text-slate-900">Campaigns this period</h4>
            </div>
            {campaigns.length === 0 ? (
              <p className="p-8 text-sm font-bold text-slate-400">
                No campaigns sent in this date range.
              </p>
            ) : (
              <div className="overflow-x-auto no-scrollbar">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
                      <th className="px-6 py-3">Campaign</th>
                      <th className="px-4 py-3">Sent</th>
                      <th className="px-4 py-3">Emails</th>
                      <th className="px-4 py-3">Open rate</th>
                      <th className="px-4 py-3">Click rate</th>
                      <th className="px-4 py-3">Unique opens</th>
                      <th className="px-6 py-3">Unsubs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((c) => (
                      <tr key={c.id} className="border-b border-slate-50 last:border-0">
                        <td className="px-6 py-3 font-bold text-slate-800 max-w-[240px] truncate">
                          {c.title || c.id}
                        </td>
                        <td className="px-4 py-3 text-slate-500 font-medium">
                          {formatDay(c.sendDate)}
                        </td>
                        <td className="px-4 py-3 tabular-nums font-medium">
                          {formatNum(c.emailsSent)}
                        </td>
                        <td className="px-4 py-3 tabular-nums font-medium">
                          {c.openRate != null
                            ? `${(Number(c.openRate) * 100).toFixed(1)}%`
                            : '—'}
                        </td>
                        <td className="px-4 py-3 tabular-nums font-medium">
                          {c.clickRate != null
                            ? `${(Number(c.clickRate) * 100).toFixed(1)}%`
                            : '—'}
                        </td>
                        <td className="px-4 py-3 tabular-nums font-medium">
                          {formatNum(c.uniqueOpens)}
                        </td>
                        <td className="px-6 py-3 tabular-nums font-medium">
                          {formatNum(c.unsubscribes)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </PanelShell>
  );
}

function SocialAnalyticsPanel({ client, dateFromMs, dateToMs }) {
  const { loading, error, report, load, range } = useAnalyticsReport(
    '/.netlify/functions/portal-planable',
    client?.id,
    dateFromMs,
    dateToMs,
    true,
  );

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-[28px] p-12 shadow-sm flex flex-col items-center gap-3 text-slate-500">
        <Loader2 className="w-6 h-6 animate-spin text-[#fd7414]" />
        <p className="text-sm font-bold">Loading social analytics…</p>
      </div>
    );
  }

  if (error) {
    return (
      <PanelShell title="Social Media" onRefresh={load} loading={loading}>
        <p className="text-sm font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3">
          {error}
        </p>
      </PanelShell>
    );
  }

  const totals = report?.totals || {};
  const pages = Array.isArray(report?.pages) ? report.pages : [];
  const platforms = Array.isArray(report?.platforms) ? report.platforms : [];
  const topPosts = Array.isArray(report?.topPosts) ? report.topPosts : [];
  const maxPlatformEngagement = Math.max(
    1,
    ...platforms.map((p) => Number(p.engagement || p.impressions || 0)),
  );

  return (
    <PanelShell
      title="Social Media"
      subtitle={`Planable · ${formatDay(range.from)} – ${formatDay(range.to)}${cacheSubtitleSuffix(report)}`}
      onRefresh={load}
      loading={loading}
    >
      {report?.warning ? (
        <p className="text-sm font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3">
          {report.warning}
        </p>
      ) : null}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Impressions" value={formatNum(totals.impressions)} />
        <StatCard label="Reach" value={formatNum(totals.reach)} />
        <StatCard label="Engagement" value={formatNum(totals.engagement)} />
        <StatCard label="Channels" value={formatNum(pages.length)} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Followers" value={formatNum(totals.followers)} />
        <StatCard
          label="Follower growth"
          value={
            totals.gainedFollowers != null && totals.gainedFollowers !== 0
              ? `${Number(totals.gainedFollowers) > 0 ? '+' : ''}${formatNum(totals.gainedFollowers)}`
              : formatNum(totals.gainedFollowers)
          }
        />
        <StatCard label="Likes / reactions" value={formatNum(totals.likes)} />
        <StatCard label="Comments" value={formatNum(totals.comments)} />
      </div>

      <div className="bg-white border border-slate-200 rounded-[28px] p-6 shadow-sm space-y-4">
        <div>
          <h4 className="font-black text-slate-900">By platform</h4>
          <p className="text-xs text-slate-500 font-medium mt-1">
            Rolled up from connected Planable channels in this date range
          </p>
        </div>
        {platforms.length === 0 ? (
          <p className="text-sm font-bold text-slate-400">No platform metrics yet.</p>
        ) : (
          <ul className="space-y-3">
            {platforms.map((p) => {
              const share = Math.min(
                100,
                Math.max(
                  2,
                  ((Number(p.engagement || p.impressions || 0) / maxPlatformEngagement) * 100) || 0,
                ),
              );
              return (
                <li key={p.platform}>
                  <div className="flex items-center justify-between gap-3 text-sm mb-1">
                    <span className="font-bold text-slate-800">
                      {p.platform}
                      <span className="text-slate-400 font-bold text-xs ml-2">
                        {p.channels} channel{p.channels === 1 ? '' : 's'}
                      </span>
                    </span>
                    <span className="tabular-nums font-black text-slate-900">
                      {formatNum(p.engagement)} eng
                      <span className="text-slate-400 font-bold text-xs ml-2">
                        {formatNum(p.impressions)} impr
                      </span>
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#fd7414]"
                      style={{ width: `${share}%` }}
                    />
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    <span>Reach {formatNum(p.reach)}</span>
                    {p.likes ? <span>Likes {formatNum(p.likes)}</span> : null}
                    {p.comments ? <span>Comments {formatNum(p.comments)}</span> : null}
                    {p.shares ? <span>Shares {formatNum(p.shares)}</span> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-[28px] shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100">
          <h4 className="font-black text-slate-900">Channels</h4>
          <p className="text-xs text-slate-500 font-medium mt-0.5">
            Individual connected pages in Planable
          </p>
        </div>
        {pages.length === 0 ? (
          <p className="p-8 text-sm font-bold text-slate-400">
            No Planable pages found for this workspace.
          </p>
        ) : (
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
                  <th className="px-6 py-3">Page</th>
                  <th className="px-4 py-3">Platform</th>
                  <th className="px-4 py-3">Impressions</th>
                  <th className="px-4 py-3">Reach</th>
                  <th className="px-4 py-3">Engagement</th>
                  <th className="px-6 py-3">Likes</th>
                </tr>
              </thead>
              <tbody>
                {pages.map((p) => (
                  <tr key={p.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-6 py-3 font-bold text-slate-800 max-w-[220px] truncate">
                      {p.name || p.id}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-600">
                      {p.platform || p.type || '—'}
                    </td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {formatNum(p.impressions)}
                    </td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {formatNum(p.reach)}
                    </td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {formatNum(p.engagement)}
                    </td>
                    <td className="px-6 py-3 tabular-nums font-medium">
                      {formatNum(p.likes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-[28px] shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100">
          <h4 className="font-black text-slate-900">Top posts</h4>
          <p className="text-xs text-slate-500 font-medium mt-0.5">
            Highest engagement in this date range (when Planable has post metrics synced)
          </p>
        </div>
        {topPosts.length === 0 ? (
          <p className="p-8 text-sm font-bold text-slate-400">
            No post metrics in this range yet. Posts need to be published and analytics synced in
            Planable.
          </p>
        ) : (
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
                  <th className="px-6 py-3">Post</th>
                  <th className="px-4 py-3">Platform</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Engagement</th>
                  <th className="px-4 py-3">Impr.</th>
                  <th className="px-6 py-3">Reactions</th>
                </tr>
              </thead>
              <tbody>
                {topPosts.map((p) => (
                  <tr key={p.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-6 py-3 font-bold text-slate-800 max-w-[280px]">
                      <div className="truncate">{p.text || '(No caption)'}</div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5 truncate">
                        {p.pageName}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-600">{p.platform || '—'}</td>
                    <td className="px-4 py-3 text-slate-500 font-medium">
                      {formatDay(p.date)}
                    </td>
                    <td className="px-4 py-3 tabular-nums font-black text-slate-900">
                      {formatNum(p.engagement)}
                    </td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {formatNum(p.impressions)}
                    </td>
                    <td className="px-6 py-3 tabular-nums font-medium">
                      {formatNum(p.reactions || p.likes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PanelShell>
  );
}

function AdsAnalyticsPanel({ client, dateFromMs, dateToMs }) {
  const { loading, error, report, load, range } = useAnalyticsReport(
    '/.netlify/functions/portal-google-ads',
    client?.id,
    dateFromMs,
    dateToMs,
    true,
  );

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-[28px] p-12 shadow-sm flex flex-col items-center gap-3 text-slate-500">
        <Loader2 className="w-6 h-6 animate-spin text-[#fd7414]" />
        <p className="text-sm font-bold">Loading ads analytics…</p>
      </div>
    );
  }

  if (error) {
    return (
      <PanelShell title="Ads" onRefresh={load} loading={loading}>
        <p className="text-sm font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3">
          {error}
        </p>
      </PanelShell>
    );
  }

  const totals = report?.totals || {};
  const campaigns = Array.isArray(report?.campaigns) ? report.campaigns : [];

  return (
    <PanelShell
      title="Ads"
      subtitle={`Google Ads · ${formatDay(range.from)} – ${formatDay(range.to)}${cacheSubtitleSuffix(report)}`}
      onRefresh={load}
      loading={loading}
    >
      {report?.warning ? (
        <p className="text-sm font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3">
          {report.warning}
        </p>
      ) : null}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard label="Spend" value={formatMoney(totals.spend)} />
        <StatCard label="Clicks" value={formatNum(totals.clicks)} />
        <StatCard label="Impressions" value={formatNum(totals.impressions)} />
        <StatCard
          label="CTR"
          value={
            totals.ctr != null ? `${(Number(totals.ctr) * 100).toFixed(2)}%` : '—'
          }
        />
        <StatCard label="Conversions" value={formatNum(totals.conversions, 1)} />
      </div>

      <div className="bg-white border border-slate-200 rounded-[28px] shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100">
          <h4 className="font-black text-slate-900">Top campaigns</h4>
        </div>
        {campaigns.length === 0 ? (
          <p className="p-8 text-sm font-bold text-slate-400">
            No campaign activity in this date range.
          </p>
        ) : (
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
                  <th className="px-6 py-3">Campaign</th>
                  <th className="px-4 py-3">Spend</th>
                  <th className="px-4 py-3">Clicks</th>
                  <th className="px-4 py-3">Impr.</th>
                  <th className="px-4 py-3">CTR</th>
                  <th className="px-6 py-3">Conv.</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-6 py-3 font-bold text-slate-800 max-w-[240px] truncate">
                      {c.name || c.id}
                    </td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {formatMoney(c.spend)}
                    </td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {formatNum(c.clicks)}
                    </td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {formatNum(c.impressions)}
                    </td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {c.ctr != null ? `${(Number(c.ctr) * 100).toFixed(2)}%` : '—'}
                    </td>
                    <td className="px-6 py-3 tabular-nums font-medium">
                      {formatNum(c.conversions, 1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PanelShell>
  );
}

/**
 * Portal / staff Analytics hub — Website (SEO), Email, Social, Ads.
 * @param {'portal'|'staff'} variant — staff sees all sub-tabs (retainer gates skipped in UI).
 */
export default function ClientPortalAnalyticsPanel({
  client,
  dateFromMs,
  dateToMs,
  variant = 'portal',
}) {
  const isStaffView = variant === 'staff';
  const enabledTabs = useMemo(
    () =>
      TABS.map((tab) => ({
        ...tab,
        enabled: isStaffView ? true : tab.gate(client),
      })),
    [client, isStaffView],
  );

  const firstEnabled = enabledTabs.find((t) => t.enabled)?.id || 'website';
  const [subTab, setSubTab] = useState(firstEnabled);
  const [preset, setPreset] = useState('billing');
  const [customFrom, setCustomFrom] = useState(() => toYmdLocal(dateFromMs || daysAgoStart(30)));
  const [customTo, setCustomTo] = useState(() => toYmdLocal(dateToMs || Date.now()));

  useEffect(() => {
    // Keep custom inputs aligned when billing cycle changes and preset is billing.
    if (preset === 'billing') {
      setCustomFrom(toYmdLocal(dateFromMs || daysAgoStart(30)));
      setCustomTo(toYmdLocal(dateToMs || Date.now()));
    }
  }, [dateFromMs, dateToMs, preset]);

  useEffect(() => {
    const current = enabledTabs.find((t) => t.id === subTab);
    if (!current?.enabled) {
      setSubTab(firstEnabled);
    }
  }, [enabledTabs, firstEnabled, subTab]);

  const range = useMemo(
    () => resolvePresetRange(preset, dateFromMs, dateToMs, customFrom, customTo),
    [preset, dateFromMs, dateToMs, customFrom, customTo],
  );

  return (
    <div className="space-y-6 max-w-full overflow-x-hidden">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-11 h-11 rounded-2xl bg-slate-100 flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-[#fd7414]" />
          </div>
          <div>
            <h2 className="text-3xl font-black text-slate-900">Analytics</h2>
            <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] mt-0.5">
              {isStaffView
                ? 'Staff view · Website · Email · Social · Ads'
                : 'Website · Email · Social · Ads'}
            </p>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-3 sm:p-4 shadow-sm space-y-3 w-full lg:w-auto lg:min-w-[360px]">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
            <CalendarRange className="w-3.5 h-3.5 text-[#fd7414]" />
            Date range
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPreset(p.id)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                  preset === p.id
                    ? 'bg-[#fd7414] text-white'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {preset === 'custom' ? (
            <div className="flex flex-col sm:flex-row gap-2">
              <label className="flex-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                From
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#fd7414]"
                />
              </label>
              <label className="flex-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                To
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#fd7414]"
                />
              </label>
            </div>
          ) : (
            <p className="text-xs font-bold text-slate-500">
              {toYmdLocal(range.fromMs)} → {toYmdLocal(range.toMs)}
            </p>
          )}
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1">
        {enabledTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            disabled={!tab.enabled}
            title={!tab.enabled ? tab.disabledTitle : undefined}
            onClick={() => {
              if (!tab.enabled) return;
              setSubTab(tab.id);
            }}
            className={`shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
              !tab.enabled
                ? 'bg-slate-50 text-slate-300 cursor-not-allowed opacity-60'
                : subTab === tab.id
                  ? 'bg-[#fd7414] text-white shadow-sm'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {subTab === 'website' && (isStaffView || clientHasActiveSeoRetainer(client)) ? (
        <ClientPortalSeoPanel
          client={client}
          dateFromMs={range.fromMs}
          dateToMs={range.toMs}
        />
      ) : null}

      {subTab === 'email' && (isStaffView || clientHasActiveEmailRetainer(client)) ? (
        <EmailAnalyticsPanel
          client={client}
          dateFromMs={range.fromMs}
          dateToMs={range.toMs}
        />
      ) : null}

      {subTab === 'social' && (isStaffView || clientHasActiveSocialMediaRetainer(client)) ? (
        <SocialAnalyticsPanel
          client={client}
          dateFromMs={range.fromMs}
          dateToMs={range.toMs}
        />
      ) : null}

      {subTab === 'ads' && (isStaffView || clientHasActiveAdsRetainer(client)) ? (
        <AdsAnalyticsPanel
          client={client}
          dateFromMs={range.fromMs}
          dateToMs={range.toMs}
        />
      ) : null}
    </div>
  );
}

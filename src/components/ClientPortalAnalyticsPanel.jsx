import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
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

  const load = async () => {
    if (!enabled || !clientId) return;
    setLoading(true);
    setError('');
    try {
      const resp = await authedFetch(endpoint, {
        clientId,
        dateFrom: range.from,
        dateTo: range.to,
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

  return { loading, error, report, load, range };
}

function EmailAnalyticsPanel({ client, dateFromMs, dateToMs }) {
  const { loading, error, report, load, range } = useAnalyticsReport(
    '/.netlify/functions/portal-mailchimp',
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

  return (
    <PanelShell
      title="Email"
      subtitle={`Mailchimp · ${formatDay(range.from)} – ${formatDay(range.to)}`}
      onRefresh={load}
      loading={loading}
    >
      {report?.warning ? (
        <p className="text-sm font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3">
          {report.warning}
        </p>
      ) : null}

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

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <StatCard
          label="Avg click rate"
          value={
            totals.avgClickRate != null
              ? `${(Number(totals.avgClickRate) * 100).toFixed(1)}%`
              : '—'
          }
        />
        <StatCard label="Unsubscribes" value={formatNum(totals.unsubscribes)} />
        <StatCard
          label="Audience"
          value={audience.name || '—'}
          hint={audience.id ? `List ${audience.id}` : undefined}
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-[28px] shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100">
          <h4 className="font-black text-slate-900">Campaigns this period</h4>
        </div>
        {campaigns.length === 0 ? (
          <p className="p-8 text-sm font-bold text-slate-400">
            No campaigns sent in this date range.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
                  <th className="px-6 py-3">Campaign</th>
                  <th className="px-4 py-3">Sent</th>
                  <th className="px-4 py-3">Emails</th>
                  <th className="px-4 py-3">Open rate</th>
                  <th className="px-4 py-3">Click rate</th>
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

  return (
    <PanelShell
      title="Social Media"
      subtitle={`Planable · ${formatDay(range.from)} – ${formatDay(range.to)}`}
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

      <div className="bg-white border border-slate-200 rounded-[28px] shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100">
          <h4 className="font-black text-slate-900">Channels</h4>
        </div>
        {pages.length === 0 ? (
          <p className="p-8 text-sm font-bold text-slate-400">
            No Planable pages found for this workspace.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
                  <th className="px-6 py-3">Page</th>
                  <th className="px-4 py-3">Platform</th>
                  <th className="px-4 py-3">Impressions</th>
                  <th className="px-4 py-3">Reach</th>
                  <th className="px-6 py-3">Engagement</th>
                </tr>
              </thead>
              <tbody>
                {pages.map((p) => (
                  <tr key={p.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-6 py-3 font-bold text-slate-800 max-w-[220px] truncate">
                      {p.name || p.id}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-600 capitalize">
                      {p.platform || p.type || '—'}
                    </td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {formatNum(p.impressions)}
                    </td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {formatNum(p.reach)}
                    </td>
                    <td className="px-6 py-3 tabular-nums font-medium">
                      {formatNum(p.engagement)}
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
      subtitle={`Google Ads · ${formatDay(range.from)} – ${formatDay(range.to)}`}
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
          <div className="overflow-x-auto">
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
 * Portal Analytics hub — Website (SEO), Email, Social, Ads with retainer gates.
 */
export default function ClientPortalAnalyticsPanel({ client, dateFromMs, dateToMs }) {
  const enabledTabs = useMemo(
    () =>
      TABS.map((tab) => ({
        ...tab,
        enabled: tab.gate(client),
      })),
    [client],
  );

  const firstEnabled = enabledTabs.find((t) => t.enabled)?.id || 'website';
  const [subTab, setSubTab] = useState(firstEnabled);

  useEffect(() => {
    const current = enabledTabs.find((t) => t.id === subTab);
    if (!current?.enabled) {
      setSubTab(firstEnabled);
    }
  }, [enabledTabs, firstEnabled, subTab]);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-11 h-11 rounded-2xl bg-slate-100 flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-[#fd7414]" />
          </div>
          <div>
            <h2 className="text-3xl font-black text-slate-900">Analytics</h2>
            <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] mt-0.5">
              Website · Email · Social · Ads
            </p>
          </div>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
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

      {subTab === 'website' && clientHasActiveSeoRetainer(client) ? (
        <ClientPortalSeoPanel
          client={client}
          dateFromMs={dateFromMs}
          dateToMs={dateToMs}
        />
      ) : null}

      {subTab === 'email' && clientHasActiveEmailRetainer(client) ? (
        <EmailAnalyticsPanel
          client={client}
          dateFromMs={dateFromMs}
          dateToMs={dateToMs}
        />
      ) : null}

      {subTab === 'social' && clientHasActiveSocialMediaRetainer(client) ? (
        <SocialAnalyticsPanel
          client={client}
          dateFromMs={dateFromMs}
          dateToMs={dateToMs}
        />
      ) : null}

      {subTab === 'ads' && clientHasActiveAdsRetainer(client) ? (
        <AdsAnalyticsPanel
          client={client}
          dateFromMs={dateFromMs}
          dateToMs={dateToMs}
        />
      ) : null}
    </div>
  );
}

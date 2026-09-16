import {
  describeAuthError,
  requireClientOrStaffCaller,
} from './lib/requireAuth.mjs';
import { fetchDoc, getDigestDb } from './lib/firebaseDigestClient.mjs';
import {
  fetchGa4TrafficReport,
  getValidGa4AccessToken,
  normalizeGa4PropertyId,
} from './lib/ga4OAuth.mjs';
import { wantsForceRefresh, withAnalyticsCache } from './lib/analyticsReportCache.mjs';

/**
 * Portal/staff SEO report proxy for SE Ranking Project API + optional GA4.
 * POST { clientId, dateFrom?: YYYY-MM-DD, dateTo?: YYYY-MM-DD }
 */

const SE_API = 'https://api.seranking.com/v1/project-management';

function ymd(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  return x.toISOString().slice(0, 10);
}

function addDaysYmd(ymdStr, days) {
  const d = new Date(`${ymdStr}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymdStr;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function clientHasActiveSeoRetainer(client) {
  const retainers = client?.retainers && typeof client.retainers === 'object' ? client.retainers : {};
  const flags =
    client?.retainerCategoryEnabled && typeof client.retainerCategoryEnabled === 'object'
      ? client.retainerCategoryEnabled
      : {};
  const names = [...new Set([...Object.keys(retainers), ...Object.keys(flags)])];
  return names.some((name) => {
    const lower = String(name || '').toLowerCase();
    if (!lower.includes('seo')) return false;
    if (flags[name] === false) return false;
    if (flags[name] === true) return true;
    return Number(retainers[name] || 0) > 0;
  });
}

async function seGet(apiKey, path, params = {}) {
  const url = new URL(`${SE_API}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    url.searchParams.set(k, String(v));
  });
  const resp = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Token ${apiKey}`,
      Accept: 'application/json',
    },
  });
  const text = await resp.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!resp.ok) {
    const msg =
      data?.message || data?.error || `SE Ranking HTTP ${resp.status}`;
    const err = new Error(msg);
    err.status = resp.status;
    throw err;
  }
  return data;
}

async function seGetSoft(apiKey, path, params = {}) {
  try {
    return { ok: true, data: await seGet(apiKey, path, params) };
  } catch (err) {
    return {
      ok: false,
      error: err?.message || 'Request failed',
      status: err?.status || 500,
    };
  }
}

function seriesAvgRow(historyPayload) {
  const rows = Array.isArray(historyPayload?.data) ? historyPayload.data : [];
  const avg = rows.find((r) => r?.type === 'avg') || rows[0] || null;
  if (!avg) return [];
  return (Array.isArray(avg.data) ? avg.data : []).map((p) => ({
    date: String(p.date || ''),
    value: Number(p.value),
  }));
}

/** Compare latest series point to the point closest to ~7 days earlier. */
function weekOverWeekFromSeries(points, { lowerIsBetter = false } = {}) {
  const series = (points || [])
    .filter((p) => p?.date && Number.isFinite(Number(p.value)))
    .map((p) => ({ date: String(p.date), value: Number(p.value) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (series.length < 2) {
    return {
      current: series[0]?.value ?? null,
      prior: null,
      delta: null,
      improved: null,
      currentDate: series[0]?.date || null,
      priorDate: null,
    };
  }
  const current = series[series.length - 1];
  const target = addDaysYmd(current.date, -7);
  let prior = series[0];
  let bestDiff = Math.abs(
    new Date(`${prior.date}T12:00:00Z`) - new Date(`${target}T12:00:00Z`),
  );
  for (const p of series.slice(0, -1)) {
    const diff = Math.abs(
      new Date(`${p.date}T12:00:00Z`) - new Date(`${target}T12:00:00Z`),
    );
    if (diff <= bestDiff) {
      bestDiff = diff;
      prior = p;
    }
  }
  // Require prior to be at least ~4 days earlier so same-week noise doesn't count.
  const daysApart =
    (new Date(`${current.date}T12:00:00Z`) - new Date(`${prior.date}T12:00:00Z`)) /
    86400000;
  if (daysApart < 4) {
    return {
      current: current.value,
      prior: null,
      delta: null,
      improved: null,
      currentDate: current.date,
      priorDate: null,
    };
  }
  const delta = current.value - prior.value;
  const improved = lowerIsBetter ? delta < 0 : delta > 0;
  return {
    current: current.value,
    prior: prior.value,
    delta,
    improved,
    currentDate: current.date,
    priorDate: prior.date,
  };
}

function pickPositionNearDate(positions, targetYmd) {
  if (!Array.isArray(positions) || !positions.length || !targetYmd) return null;
  let best = null;
  let bestDiff = Infinity;
  for (const p of positions) {
    const d = String(p?.date || '');
    if (!d) continue;
    const diff = Math.abs(
      new Date(`${d}T12:00:00Z`) - new Date(`${targetYmd}T12:00:00Z`),
    );
    if (diff < bestDiff) {
      bestDiff = diff;
      best = p;
    }
  }
  // Within 3 days of target is acceptable for sparse check schedules.
  if (bestDiff > 3 * 86400000) return null;
  return best;
}

function latestPosition(keyword) {
  const positions = Array.isArray(keyword?.positions) ? keyword.positions : [];
  if (!positions.length) return null;
  const sorted = [...positions].sort((a, b) =>
    String(b.date || '').localeCompare(String(a.date || '')),
  );
  return sorted[0] || null;
}

function latestLandingUrl(landingPages, preferDate) {
  const rows = Array.isArray(landingPages) ? landingPages : [];
  if (!rows.length) return '';
  if (preferDate) {
    const exact = rows.find((r) => String(r?.date || '') === preferDate && r?.url);
    if (exact?.url) return String(exact.url);
  }
  const sorted = [...rows]
    .filter((r) => r?.url)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return sorted[0]?.url ? String(sorted[0].url) : '';
}

function summarizeSerpFeatures(features) {
  if (!features || typeof features !== 'object') {
    return { count: 0, labels: [] };
  }
  const labels = Object.entries(features)
    .filter(([, v]) => v === true || v === 1 || v === '1')
    .map(([k]) =>
      String(k || '')
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase()),
    )
    .filter(Boolean);
  return { count: labels.length, labels: labels.slice(0, 8) };
}

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const clientId = String(body.clientId || '').trim();
  if (!clientId) {
    return new Response(JSON.stringify({ error: 'Missing client.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let caller;
  try {
    caller = await requireClientOrStaffCaller(req.headers, clientId);
  } catch (err) {
    const { status, message } = describeAuthError(err);
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = String(process.env.SE_RANKING_API_KEY || '').trim();
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error:
          'Server misconfigured: missing SE_RANKING_API_KEY in Netlify environment variables.',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  try {
    const db = await getDigestDb();
    const client = await fetchDoc(db, `clients/${clientId}`);
    if (!client) {
      return new Response(JSON.stringify({ error: 'Client not found.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!caller?.isStaff && !clientHasActiveSeoRetainer(client)) {
      return new Response(
        JSON.stringify({
          error: 'SEO reports are available with an active SEO retainer.',
          code: 'seo_retainer_required',
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const siteId = Number(client.seRankingSiteId || 0);
    if (!siteId) {
      return new Response(
        JSON.stringify({
          error:
            'SE Ranking project is not linked yet. Ask Ignite to connect your site ID.',
          code: 'site_id_missing',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const today = ymd();
    let dateFrom = String(body.dateFrom || '').trim() || ymd(Date.now() - 30 * 86400000);
    let dateTo = String(body.dateTo || '').trim() || today;
    if (dateFrom > dateTo) {
      const tmp = dateFrom;
      dateFrom = dateTo;
      dateTo = tmp;
    }

    const forceRefresh = wantsForceRefresh(body);

    const report = await withAnalyticsCache({
      db,
      source: 'website',
      clientId,
      dateFrom,
      dateTo,
      forceRefresh,
      build: async () => {
    // Pull enough history for week-over-week even near the start of a billing cycle.
    const historyFrom = addDaysYmd(dateFrom, -14);
    const positionsFrom = historyFrom;

    const [
      summary,
      visibilityHistory,
      avgPosHistory,
      keywords,
      positionsGroups,
      gscResult,
      potentialResult,
      backlinksResult,
    ] = await Promise.all([
      seGet(apiKey, '/sites/summary', { site_id: siteId }),
      seGet(apiKey, '/sites/positions/history', {
        site_id: siteId,
        type: 'visibility_percent',
        date_from: historyFrom,
        date_to: dateTo,
      }),
      seGet(apiKey, '/sites/positions/history', {
        site_id: siteId,
        type: 'avg_pos',
        date_from: historyFrom,
        date_to: dateTo,
      }),
      seGet(apiKey, '/keywords', { site_id: siteId }),
      seGet(apiKey, '/sites/positions', {
        site_id: siteId,
        date_from: positionsFrom,
        date_to: dateTo,
        with_landing_pages: 1,
        with_serp_features: 1,
        with_content_score: 1,
      }),
      seGetSoft(apiKey, '/analytics/gsc/queries', { site_id: siteId }),
      seGetSoft(apiKey, '/analytics/seo-potential', { site_id: siteId }),
      seGetSoft(apiKey, '/backlinks/stats', { site_id: siteId }),
    ]);

    const visibilityTrend = seriesAvgRow(visibilityHistory);
    const avgPositionTrend = seriesAvgRow(avgPosHistory);
    const wowVisibility = weekOverWeekFromSeries(visibilityTrend);
    const wowAvgPosition = weekOverWeekFromSeries(avgPositionTrend, {
      lowerIsBetter: true,
    });

    // Chart series for the selected reporting window only.
    const visibilityTrendInRange = visibilityTrend.filter(
      (p) => p.date >= dateFrom && p.date <= dateTo,
    );
    const avgPositionTrendInRange = avgPositionTrend.filter(
      (p) => p.date >= dateFrom && p.date <= dateTo,
    );

    const nameById = new Map();
    (Array.isArray(keywords) ? keywords : []).forEach((k) => {
      nameById.set(String(k.id), String(k.name || '').trim());
    });

    const engineBlocks = Array.isArray(positionsGroups) ? positionsGroups : [];
    const keywordRows = [];
    for (const block of engineBlocks) {
      const engineId = block?.site_engine_id;
      for (const kw of Array.isArray(block?.keywords) ? block.keywords : []) {
        const latest = latestPosition(kw);
        if (!latest) continue;
        const weekAgoTarget = addDaysYmd(String(latest.date || dateTo), -7);
        const weekAgo = pickPositionNearDate(kw.positions, weekAgoTarget);
        const currentPos = Number(latest.pos) || 0;
        const priorPos = weekAgo ? Number(weekAgo.pos) || 0 : null;
        let wowDelta = null;
        if (priorPos != null && currentPos > 0 && priorPos > 0) {
          // Positive delta = improved (moved up / lower rank number).
          wowDelta = priorPos - currentPos;
        }
        const serp = summarizeSerpFeatures(kw.features);
        keywordRows.push({
          id: String(kw.id),
          name: nameById.get(String(kw.id)) || `Keyword ${kw.id}`,
          position: currentPos,
          change: Number(latest.change) || 0,
          wowDelta,
          priorPosition: priorPos,
          priorDate: weekAgo ? String(weekAgo.date || '') : null,
          volume: Number(kw.volume) || 0,
          competition: kw.competition != null ? Number(kw.competition) : null,
          contentScore:
            kw.content_score != null && Number.isFinite(Number(kw.content_score))
              ? Number(kw.content_score)
              : null,
          contentScoreChange:
            kw.content_score_change != null &&
            Number.isFinite(Number(kw.content_score_change))
              ? Number(kw.content_score_change)
              : null,
          landingUrl: latestLandingUrl(kw.landing_pages, String(latest.date || '')),
          serpFeatureCount: serp.count,
          serpFeatures: serp.labels,
          date: String(latest.date || ''),
          siteEngineId: engineId ?? null,
        });
      }
    }

    const bestById = new Map();
    for (const row of keywordRows) {
      const prev = bestById.get(row.id);
      if (!prev) {
        bestById.set(row.id, row);
        continue;
      }
      const prevPos = prev.position > 0 ? prev.position : 9999;
      const nextPos = row.position > 0 ? row.position : 9999;
      if (nextPos < prevPos) bestById.set(row.id, row);
    }

    const keywordTable = [...bestById.values()]
      .sort((a, b) => {
        const ap = a.position > 0 ? a.position : 9999;
        const bp = b.position > 0 ? b.position : 9999;
        return ap - bp;
      })
      .slice(0, 75);

    const wowImproved = keywordTable.filter((k) => (k.wowDelta ?? 0) > 0).length;
    const wowDeclined = keywordTable.filter((k) => (k.wowDelta ?? 0) < 0).length;
    const wowFlat = keywordTable.filter((k) => k.wowDelta === 0).length;

    let traffic = {
      available: false,
      source: null,
      clicks: 0,
      impressions: 0,
      avgCtr: null,
      avgPosition: null,
      queries: [],
      warning: null,
      estimatedTraffic: null,
      estimatedTrafficValue: null,
    };

    if (gscResult.ok && Array.isArray(gscResult.data)) {
      const queries = gscResult.data
        .map((q) => ({
          query: String(q.query || '').trim(),
          clicks: Number(q.clicks) || 0,
          impressions: Number(q.impressions) || 0,
          ctr: Number(q.ctr) || 0,
          avg: Number(q.avg) || null,
        }))
        .filter((q) => q.query)
        .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);

      const clicks = queries.reduce((s, q) => s + q.clicks, 0);
      const impressions = queries.reduce((s, q) => s + q.impressions, 0);
      const weightedPos = queries.reduce(
        (s, q) => s + (q.avg != null ? q.avg * q.impressions : 0),
        0,
      );

      traffic = {
        available: true,
        source: 'gsc',
        clicks,
        impressions,
        avgCtr: impressions > 0 ? (clicks / impressions) * 100 : null,
        avgPosition: impressions > 0 ? weightedPos / impressions : null,
        queries: queries.slice(0, 25),
        warning: null,
        estimatedTraffic: null,
        estimatedTrafficValue: null,
      };
    } else {
      traffic.warning =
        gscResult.error ||
        'Google Search Console data is not connected for this SE Ranking project.';
    }

    if (potentialResult.ok && Array.isArray(potentialResult.data)) {
      const estimatedTraffic = potentialResult.data.reduce(
        (s, row) => s + (Number(row.traffic) || 0),
        0,
      );
      const estimatedTrafficValue = potentialResult.data.reduce(
        (s, row) => s + (Number(row.traffic_value) || 0),
        0,
      );
      traffic.estimatedTraffic = estimatedTraffic;
      traffic.estimatedTrafficValue = estimatedTrafficValue;
      if (!traffic.available) {
        traffic.available = estimatedTraffic > 0;
        traffic.source = 'seo_potential';
      }
    }

    let analytics = {
      available: false,
      warning: null,
      propertyId: null,
      sessions: 0,
      users: 0,
      newUsers: 0,
      engagementRate: null,
      avgSessionDuration: null,
      channels: [],
      dateFrom,
      dateTo,
    };

    const ga4PropertyId = normalizeGa4PropertyId(client.ga4PropertyId);
    if (ga4PropertyId) {
      try {
        const { accessToken } = await getValidGa4AccessToken();
        analytics = await fetchGa4TrafficReport(
          accessToken,
          ga4PropertyId,
          dateFrom,
          dateTo,
        );
      } catch (err) {
        analytics = {
          available: false,
          warning:
            err?.message ||
            'Could not load Google Analytics. Connect GA4 in Admin → Config and confirm property access.',
          propertyId: ga4PropertyId,
          sessions: 0,
          users: 0,
          newUsers: 0,
          engagementRate: null,
          avgSessionDuration: null,
          channels: [],
          dateFrom,
          dateTo,
        };
      }
    } else {
      analytics.warning =
        'No GA4 property linked yet. Ask Ignite to add the GA4 property ID on your account.';
    }

    return {
      siteId,
      dateFrom,
      dateTo,
      project: {
        title: summary?.title || summary?.name || '',
        domain: summary?.name || '',
        todayAvg: Number(summary?.today_avg) || null,
        yesterdayAvg: Number(summary?.yesterday_avg) || null,
        totalUp: Number(summary?.total_up) || 0,
        totalDown: Number(summary?.total_down) || 0,
        top5: Number(summary?.top5) || 0,
        top10: Number(summary?.top10) || 0,
        top30: Number(summary?.top30) || 0,
        visibility: Number(summary?.visibility) || null,
        visibilityPercent: Number(summary?.visibility_percent) || null,
      },
      visibilityTrend: visibilityTrendInRange,
      avgPositionTrend: avgPositionTrendInRange,
      weekOverWeek: {
        visibility: wowVisibility,
        avgPosition: wowAvgPosition,
        keywordsImproved: wowImproved,
        keywordsDeclined: wowDeclined,
        keywordsFlat: wowFlat,
      },
      traffic,
      analytics,
      backlinks: backlinksResult.ok
        ? {
            available: true,
            total: Number(backlinksResult.data?.total || 0),
            domains: Number(backlinksResult.data?.domains || 0),
            anchors: Number(backlinksResult.data?.anchors || 0),
            ips: Number(backlinksResult.data?.ip || 0),
            dofollow: Number(backlinksResult.data?.dofollow || 0),
            nofollow: Number(backlinksResult.data?.nofollow || 0),
          }
        : {
            available: false,
            warning:
              backlinksResult.error ||
              'Backlink stats are not available for this SE Ranking project.',
            total: 0,
            domains: 0,
            anchors: 0,
            ips: 0,
            dofollow: 0,
            nofollow: 0,
          },
      keywords: keywordTable,
      keywordCount: keywordTable.length,
      fetchedAt: Date.now(),
      fetchedBy: caller.email,
    };
      },
    });

    return new Response(JSON.stringify(report), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[portal-se-ranking]', err);
    return new Response(
      JSON.stringify({
        error: err?.message || 'Could not load SE Ranking data.',
        status: err?.status || 500,
      }),
      {
        status: Number(err?.status) >= 400 && Number(err?.status) < 600 ? err.status : 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
};

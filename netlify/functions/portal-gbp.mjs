import {
  describeAuthError,
  requireClientOrStaffCaller,
} from './lib/requireAuth.mjs';
import { fetchDoc, getDigestDb } from './lib/firebaseDigestClient.mjs';
import { clientHasActiveSeoRetainer } from './lib/retainerAccess.mjs';
import { wantsForceRefresh, withAnalyticsCache } from './lib/analyticsReportCache.mjs';

/**
 * Portal/staff Local SEO via SE Ranking Local Marketing API (GBP metrics).
 * POST { clientId, dateFrom?: YYYY-MM-DD, dateTo?: YYYY-MM-DD, forceRefresh? }
 *
 * Uses the same SE_RANKING_API_KEY as Project API. Per-client field:
 * clients.seRankingLocalLocationId (Local Marketing location id).
 */

const SE_LOCAL = 'https://api.seranking.com/v1/local-marketing';

function ymd(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  return x.toISOString().slice(0, 10);
}

function normalizeLocalLocationId(raw) {
  const s = String(raw || '')
    .trim()
    .replace(/[^\d]/g, '');
  return s || '';
}

async function seLocalGet(apiKey, path, params = {}) {
  const url = new URL(`${SE_LOCAL}${path}`);
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
      data?.message || data?.error || `SE Ranking Local Marketing HTTP ${resp.status}`;
    const err = new Error(msg);
    err.status = resp.status;
    throw err;
  }
  return data;
}

function sumMetric(items, key) {
  let total = 0;
  for (const row of Array.isArray(items) ? items : []) {
    const v = Number(row?.metrics?.[key]);
    if (Number.isFinite(v)) total += v;
  }
  return total;
}

function buildTotalsFromMetrics(items) {
  const searchViews =
    sumMetric(items, 'business_impressions_desktop_search') +
    sumMetric(items, 'business_impressions_mobile_search');
  const mapViews =
    sumMetric(items, 'business_impressions_desktop_maps') +
    sumMetric(items, 'business_impressions_mobile_maps');
  const websiteClicks = sumMetric(items, 'website_clicks');
  const calls = sumMetric(items, 'call_clicks');
  const directionRequests = sumMetric(items, 'business_direction_requests');
  const conversations = sumMetric(items, 'business_conversations');
  return {
    searchViews,
    mapViews,
    listingViews: searchViews + mapViews,
    websiteClicks,
    calls,
    directionRequests,
    conversations,
    photoViews: null,
  };
}

const emptyTotals = {
  searchViews: 0,
  mapViews: 0,
  listingViews: 0,
  websiteClicks: 0,
  calls: 0,
  directionRequests: 0,
  conversations: 0,
  photoViews: null,
};

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
    return new Response(JSON.stringify({ error: 'clientId is required.' }), {
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
          error: 'Local SEO analytics requires an active SEO retainer.',
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const dateFrom =
      String(body.dateFrom || '').trim() || ymd(new Date(Date.now() - 30 * 86400000));
    const dateTo = String(body.dateTo || '').trim() || ymd();
    const locationId =
      normalizeLocalLocationId(client.seRankingLocalLocationId) ||
      normalizeLocalLocationId(client.googleBusinessProfileLocationId);

    if (!locationId) {
      return new Response(
        JSON.stringify({
          ok: true,
          available: false,
          source: 'se_ranking_local',
          warning:
            'No SE Ranking Local Marketing location ID on this client. Add the location in SE Ranking Local Marketing, then paste its ID on the CRM profile (Admin → Config lists locations).',
          dateFrom,
          dateTo,
          totals: emptyTotals,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const forceRefresh = wantsForceRefresh(body);
    const report = await withAnalyticsCache({
      db,
      source: 'gbp',
      clientId,
      dateFrom,
      dateTo,
      forceRefresh,
      build: async () => {
        const [metrics, searches] = await Promise.all([
          seLocalGet(apiKey, `/locations/${encodeURIComponent(locationId)}/gbp-metrics`, {
            from: dateFrom,
            to: dateTo,
            group_by: 'DAY',
          }),
          seLocalGet(apiKey, `/locations/${encodeURIComponent(locationId)}/gbp-searches`, {
            from: dateFrom,
            to: dateTo,
          }).catch(() => null),
        ]);

        const items = Array.isArray(metrics?.items) ? metrics.items : [];
        const totals = buildTotalsFromMetrics(items);

        let searchBreakdown = null;
        const searchItems = Array.isArray(searches?.items) ? searches.items : [];
        if (searchItems.length) {
          searchBreakdown = searchItems.reduce(
            (acc, row) => ({
              direct: acc.direct + (Number(row.direct) || 0),
              discovery: acc.discovery + (Number(row.discovery) || 0),
              branded: acc.branded + (Number(row.branded) || 0),
            }),
            { direct: 0, discovery: 0, branded: 0 },
          );
        }

        return {
          ok: true,
          available: true,
          source: 'se_ranking_local',
          locationId,
          dateFrom,
          dateTo,
          totals,
          searchBreakdown,
          lastUpdatedDate: searches?.last_updated_date || null,
        };
      },
    });

    return new Response(JSON.stringify(report), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[portal-gbp]', err);
    return new Response(
      JSON.stringify({
        error: err?.message || 'Could not load Local SEO analytics from SE Ranking.',
      }),
      { status: err?.status && err.status < 500 ? err.status : 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

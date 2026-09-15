import {
  describeAuthError,
  requireClientOrStaffCaller,
} from './lib/requireAuth.mjs';
import { fetchDoc, getDigestDb } from './lib/firebaseDigestClient.mjs';
import { clientHasActiveSocialMediaRetainer } from './lib/retainerAccess.mjs';

/**
 * Portal/staff Planable social analytics proxy.
 * POST { clientId, dateFrom?: YYYY-MM-DD, dateTo?: YYYY-MM-DD }
 */

const PLANABLE_API = 'https://api.planable.io/api/v1';

function ymd(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  return x.toISOString().slice(0, 10);
}

function toIsoStart(ymdStr) {
  return `${ymdStr}T00:00:00.000Z`;
}

function toIsoEnd(ymdStr) {
  return `${ymdStr}T23:59:59.999Z`;
}

async function planableGet(token, path, params = {}) {
  const url = new URL(`${PLANABLE_API}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    url.searchParams.set(k, String(v));
  });
  const resp = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg =
      data?.error?.message || data?.message || data?.error || `Planable HTTP ${resp.status}`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = resp.status;
    throw err;
  }
  return data;
}

function pickMetric(obj, keys) {
  if (!obj || typeof obj !== 'object') return 0;
  for (const key of keys) {
    if (obj[key] != null && Number.isFinite(Number(obj[key]))) {
      return Number(obj[key]);
    }
  }
  return 0;
}

function sumSnapshotMetrics(snapshots) {
  let impressions = 0;
  let reach = 0;
  let engagement = 0;
  for (const snap of snapshots) {
    const platformBlocks = Object.entries(snap || {}).filter(
      ([k, v]) => v && typeof v === 'object' && !['pageId', 'pageType', 'fetchedAt', 'id'].includes(k),
    );
    if (platformBlocks.length === 0) {
      impressions += pickMetric(snap, ['impressions', 'impression', 'views', 'videoViews']);
      reach += pickMetric(snap, ['reach', 'uniqueImpressions', 'followers']);
      engagement += pickMetric(snap, [
        'engagement',
        'engagements',
        'likes',
        'comments',
        'shares',
        'reactions',
      ]);
      continue;
    }
    for (const [, block] of platformBlocks) {
      impressions += pickMetric(block, [
        'impressions',
        'impression',
        'views',
        'videoViews',
        'pageImpressions',
      ]);
      reach += pickMetric(block, ['reach', 'uniqueImpressions', 'followers', 'pageFans']);
      engagement += pickMetric(block, [
        'engagement',
        'engagements',
        'likes',
        'comments',
        'shares',
        'reactions',
        'pageEngagedUsers',
      ]);
    }
  }
  return { impressions, reach, engagement };
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
    return new Response(JSON.stringify({ error: 'clientId is required.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    await requireClientOrStaffCaller(req.headers, clientId);
  } catch (err) {
    const { status, message } = describeAuthError(err);
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
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

    if (!clientHasActiveSocialMediaRetainer(client)) {
      return new Response(
        JSON.stringify({
          error: 'Social analytics requires an active Social Media retainer.',
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const token = String(process.env.PLANABLE_API_TOKEN || '').trim();
    const workspaceId = String(client.planableWorkspaceId || '').trim();
    const dateFrom = String(body.dateFrom || '').trim() || ymd(new Date(Date.now() - 30 * 86400000));
    const dateTo = String(body.dateTo || '').trim() || ymd();

    if (!token) {
      return new Response(
        JSON.stringify({
          ok: true,
          available: false,
          warning:
            'Planable is not configured yet. Add PLANABLE_API_TOKEN (pln_…) in Netlify env.',
          dateFrom,
          dateTo,
          pages: [],
          totals: {},
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!workspaceId) {
      return new Response(
        JSON.stringify({
          ok: true,
          available: false,
          warning:
            'No Planable workspace ID on this client. Ask Ignite to add planableWorkspaceId on the CRM profile.',
          dateFrom,
          dateTo,
          pages: [],
          totals: {},
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const pagesPayload = await planableGet(token, '/pages', {
      workspaceId,
      limit: 50,
    });
    const rawPages = Array.isArray(pagesPayload?.data)
      ? pagesPayload.data
      : Array.isArray(pagesPayload)
        ? pagesPayload
        : [];

    const pages = [];
    let totalImpressions = 0;
    let totalReach = 0;
    let totalEngagement = 0;

    for (const page of rawPages.slice(0, 20)) {
      const id = String(page.id || page._id || '');
      if (!id) continue;
      let metrics = { impressions: 0, reach: 0, engagement: 0 };
      try {
        const metricsPayload = await planableGet(token, `/pages/${encodeURIComponent(id)}/metrics`, {
          startDate: toIsoStart(dateFrom),
          endDate: toIsoEnd(dateTo),
          limit: 90,
        });
        const snapshots = Array.isArray(metricsPayload?.data)
          ? metricsPayload.data
          : Array.isArray(metricsPayload)
            ? metricsPayload
            : [];
        metrics = sumSnapshotMetrics(snapshots);
      } catch (err) {
        console.warn('[portal-planable] metrics', id, err?.message || err);
      }

      totalImpressions += metrics.impressions;
      totalReach += metrics.reach;
      totalEngagement += metrics.engagement;

      pages.push({
        id,
        name: String(page.name || page.title || page.username || id),
        platform: String(page.type || page.pageType || page.platform || ''),
        type: String(page.type || page.pageType || ''),
        impressions: metrics.impressions,
        reach: metrics.reach,
        engagement: metrics.engagement,
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        available: true,
        dateFrom,
        dateTo,
        workspaceId,
        pages,
        totals: {
          impressions: totalImpressions,
          reach: totalReach,
          engagement: totalEngagement,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[portal-planable]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not load Planable analytics.' }),
      {
        status: err?.status && err.status < 500 ? err.status : 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
};

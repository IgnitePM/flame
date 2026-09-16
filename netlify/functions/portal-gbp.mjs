import {
  describeAuthError,
  requireClientOrStaffCaller,
} from './lib/requireAuth.mjs';
import { fetchDoc, getDigestDb } from './lib/firebaseDigestClient.mjs';
import { clientHasActiveSeoRetainer } from './lib/retainerAccess.mjs';
import {
  fetchGbpPerformanceReport,
  getValidGbpAccessToken,
  normalizeGbpLocationId,
} from './lib/gbpOAuth.mjs';
import { wantsForceRefresh, withAnalyticsCache } from './lib/analyticsReportCache.mjs';

/**
 * Portal/staff Google Business Profile (Local SEO) analytics proxy.
 * POST { clientId, dateFrom?: YYYY-MM-DD, dateTo?: YYYY-MM-DD, forceRefresh? }
 */

function ymd(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  return x.toISOString().slice(0, 10);
}

const emptyTotals = {
  searchViews: 0,
  mapViews: 0,
  websiteClicks: 0,
  calls: 0,
  directionRequests: 0,
  photoViews: 0,
  listingViews: 0,
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
    const locationId = normalizeGbpLocationId(client.googleBusinessProfileLocationId);

    if (!locationId) {
      return new Response(
        JSON.stringify({
          ok: true,
          available: false,
          warning:
            'No Google Business Profile location ID on this client. Ask Ignite to add it on the CRM profile (Admin → Config lists locations after GBP is connected).',
          dateFrom,
          dateTo,
          totals: emptyTotals,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    let accessToken;
    try {
      ({ accessToken } = await getValidGbpAccessToken());
    } catch (err) {
      return new Response(
        JSON.stringify({
          ok: true,
          available: false,
          warning:
            err?.message ||
            'Google Business Profile is not connected. Connect it in Admin → Config.',
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
        const data = await fetchGbpPerformanceReport(
          accessToken,
          locationId,
          dateFrom,
          dateTo,
        );
        return { ok: true, ...data };
      },
    });

    return new Response(JSON.stringify(report), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[portal-gbp]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not load Local SEO analytics.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

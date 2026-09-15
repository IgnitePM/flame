import {
  describeAuthError,
  requireClientOrStaffCaller,
} from './lib/requireAuth.mjs';
import { fetchDoc, getDigestDb } from './lib/firebaseDigestClient.mjs';
import { clientHasActiveAdsRetainer } from './lib/retainerAccess.mjs';
import {
  fetchAdsReport,
  getValidAdsAccessToken,
  normalizeAdsCustomerId,
} from './lib/googleAdsOAuth.mjs';

/**
 * Portal/staff Google Ads analytics proxy.
 * POST { clientId, dateFrom?: YYYY-MM-DD, dateTo?: YYYY-MM-DD }
 */

function ymd(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  return x.toISOString().slice(0, 10);
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

    if (!clientHasActiveAdsRetainer(client)) {
      return new Response(
        JSON.stringify({ error: 'Ads analytics requires an active Ads / Social Ad Budget retainer.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const dateFrom =
      String(body.dateFrom || '').trim() || ymd(new Date(Date.now() - 30 * 86400000));
    const dateTo = String(body.dateTo || '').trim() || ymd();
    const customerId = normalizeAdsCustomerId(client.googleAdsCustomerId);

    if (!customerId) {
      return new Response(
        JSON.stringify({
          ok: true,
          available: false,
          warning:
            'No Google Ads customer ID on this client. Ask Ignite to add googleAdsCustomerId on the CRM profile.',
          dateFrom,
          dateTo,
          totals: {},
          campaigns: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    let accessToken;
    try {
      ({ accessToken } = await getValidAdsAccessToken());
    } catch (err) {
      return new Response(
        JSON.stringify({
          ok: true,
          available: false,
          warning:
            err?.message ||
            'Google Ads is not connected. Connect it in Admin → Config.',
          dateFrom,
          dateTo,
          totals: {},
          campaigns: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const report = await fetchAdsReport(accessToken, customerId, dateFrom, dateTo);
    return new Response(JSON.stringify({ ok: true, ...report }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[portal-google-ads]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not load Google Ads analytics.' }),
      {
        status: err?.status && err.status < 500 ? err.status : 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
};

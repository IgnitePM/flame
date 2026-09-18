import {
  describeAuthError,
  requireClientOrStaffCaller,
} from './lib/requireAuth.mjs';
import { fetchDoc, getDigestDb } from './lib/firebaseDigestClient.mjs';
import { clientHasActiveEmailRetainer } from './lib/retainerAccess.mjs';
import { wantsForceRefresh, withAnalyticsCache } from './lib/analyticsReportCache.mjs';

/**
 * Portal/staff GoHighLevel email analytics proxy.
 * POST { clientId, dateFrom?: YYYY-MM-DD, dateTo?: YYYY-MM-DD }
 *
 * Credentials: clientIntegrationSecrets.ghlPrivateApiToken (Sub-Account Private Integration)
 * + clients.ghlLocationId
 *
 * Scopes needed on the token: emails/campaigns.readonly, emails/stats.readonly
 * (optional contacts.readonly for audience size).
 */

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = 'v3';

function ymd(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  return x.toISOString().slice(0, 10);
}

function toYmd(value) {
  if (!value) return '';
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/** GHL returns open/click rates as percentages (e.g. 45); Mailchimp UI expects 0–1. */
function rateToFraction(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n > 1) return n / 100;
  return n;
}

function mapStatsSource(campaign) {
  const raw = String(
    campaign?.campaignCategory || campaign?.source || campaign?.campaignType || '',
  )
    .trim()
    .toLowerCase();
  if (raw.includes('workflow')) return 'workflow-campaigns';
  if (raw.includes('bulk')) return 'bulk-actions';
  return 'email-campaigns';
}

function statsSourceId(campaign) {
  return String(campaign?.sourceId || campaign?.id || '').trim();
}

async function ghlGet(token, path, params = {}) {
  const url = new URL(`${GHL_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    url.searchParams.set(k, String(v));
  });
  const resp = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Version: GHL_VERSION,
      Accept: 'application/json',
    },
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg =
      (Array.isArray(data?.message) ? data.message.join('; ') : data?.message) ||
      data?.error ||
      data?.detail ||
      `GoHighLevel HTTP ${resp.status}`;
    const err = new Error(msg);
    err.status = resp.status;
    err.ghl = data;
    throw err;
  }
  return data;
}

async function ghlGetSoft(token, path, params = {}) {
  try {
    return { ok: true, data: await ghlGet(token, path, params) };
  } catch (err) {
    return {
      ok: false,
      error: err?.message || 'Request failed',
      status: err?.status || 500,
    };
  }
}

async function listSentCampaigns(token, locationId, { maxPages = 8 } = {}) {
  const all = [];
  let offset = 0;
  const limit = 20;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await ghlGetSoft(
      token,
      `/emails/locations/${encodeURIComponent(locationId)}/campaigns/emails`,
      { limit, offset, status: 'sent' },
    );
    if (!result.ok) {
      return { ok: false, error: result.error, campaigns: all };
    }
    const batch = Array.isArray(result.data?.campaigns) ? result.data.campaigns : [];
    all.push(...batch);
    const total = Number(result.data?.total || 0);
    offset += batch.length;
    if (!batch.length || (total > 0 && offset >= total) || batch.length < limit) {
      break;
    }
  }
  return { ok: true, campaigns: all };
}

async function fetchCampaignStats(token, locationId, campaign) {
  const source = mapStatsSource(campaign);
  const sourceId = statsSourceId(campaign);
  if (!sourceId) return null;
  const result = await ghlGetSoft(
    token,
    `/emails/locations/${encodeURIComponent(locationId)}/campaigns/stats/${encodeURIComponent(source)}/${encodeURIComponent(sourceId)}`,
  );
  if (!result.ok) return null;
  return result.data?.stats || null;
}

async function fetchAudienceSize(token, locationId) {
  // Contacts search returns meta.total when available.
  const contacts = await ghlGetSoft(token, '/contacts/', {
    locationId,
    limit: 1,
  });
  if (contacts.ok) {
    const total =
      Number(contacts.data?.meta?.total) ||
      Number(contacts.data?.total) ||
      Number(contacts.data?.count);
    if (Number.isFinite(total) && total >= 0) return total;
  }
  const loc = await ghlGetSoft(token, `/locations/${encodeURIComponent(locationId)}`);
  if (loc.ok) {
    const n = Number(loc.data?.location?.contactCount || loc.data?.contactCount);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
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

    if (!caller?.isStaff && !clientHasActiveEmailRetainer(client)) {
      return new Response(
        JSON.stringify({
          error: 'Email analytics requires an active Email Marketing retainer.',
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const secrets = await fetchDoc(db, `clientIntegrationSecrets/${clientId}`);
    const token = String(
      secrets?.ghlPrivateApiToken ||
        secrets?.goHighLevelApiToken ||
        process.env.GHL_PRIVATE_API_TOKEN ||
        '',
    ).trim();
    const locationId = String(client.ghlLocationId || client.goHighLevelLocationId || '').trim();
    const dateFrom =
      String(body.dateFrom || '').trim() || ymd(new Date(Date.now() - 30 * 86400000));
    const dateTo = String(body.dateTo || '').trim() || ymd();

    if (!token) {
      return new Response(
        JSON.stringify({
          ok: true,
          available: false,
          provider: 'gohighlevel',
          warning:
            'No GoHighLevel Private Integration token for this client. In the CRM, paste a Sub-Account Private Integration token with emails/campaigns.readonly and emails/stats.readonly.',
          dateFrom,
          dateTo,
          audience: {},
          campaigns: [],
          totals: {},
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!locationId) {
      return new Response(
        JSON.stringify({
          ok: true,
          available: false,
          provider: 'gohighlevel',
          warning:
            'No GoHighLevel Location ID on this client. Add it on the CRM profile (Settings → Business Profile / Locations, or from the sub-account URL).',
          dateFrom,
          dateTo,
          audience: {},
          campaigns: [],
          totals: {},
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const forceRefresh = wantsForceRefresh(body);
    const report = await withAnalyticsCache({
      db,
      source: 'email_gohighlevel',
      clientId,
      dateFrom,
      dateTo,
      forceRefresh,
      build: async () => {
        const listed = await listSentCampaigns(token, locationId);
        if (!listed.ok && listed.campaigns.length === 0) {
          return {
            ok: true,
            available: false,
            provider: 'gohighlevel',
            warning: `GoHighLevel could not list campaigns: ${listed.error}`,
            dateFrom,
            dateTo,
            audience: { id: locationId },
            campaigns: [],
            totals: {},
          };
        }

        const inRange = listed.campaigns.filter((c) => {
          if (c?.deleted) return false;
          const sendDate =
            toYmd(c.sentAt || c.sendAt || c.scheduledAt || c.updatedAt || c.createdAt);
          if (!sendDate) return false;
          return sendDate >= dateFrom && sendDate <= dateTo;
        });

        // Cap concurrent stats fetches to keep latency reasonable.
        const capped = inRange.slice(0, 40);
        const campaigns = [];
        for (const c of capped) {
          const sendDate = toYmd(
            c.sentAt || c.sendAt || c.scheduledAt || c.updatedAt || c.createdAt,
          );
          const stats = await fetchCampaignStats(token, locationId, c);
          const emailsSent = Number(stats?.sent || stats?.delivered || 0);
          const uniqueOpens = Number(stats?.opened || 0);
          const uniqueClicks = Number(stats?.clicked || 0);
          campaigns.push({
            id: String(c.id || statsSourceId(c)),
            title: String(c.name || c.id || 'Campaign'),
            sendDate,
            emailsSent,
            opens: uniqueOpens,
            uniqueOpens,
            clicks: uniqueClicks,
            uniqueClicks,
            openRate: rateToFraction(stats?.openRate),
            clickRate: rateToFraction(stats?.clickRate),
            unsubscribes: Number(stats?.unsubscribed || 0),
          });
        }

        campaigns.sort((a, b) => String(b.sendDate).localeCompare(String(a.sendDate)));

        const emailsSent = campaigns.reduce((s, c) => s + (c.emailsSent || 0), 0);
        const uniqueOpens = campaigns.reduce((s, c) => s + (c.uniqueOpens || 0), 0);
        const uniqueClicks = campaigns.reduce((s, c) => s + (c.uniqueClicks || 0), 0);
        const openRates = campaigns
          .map((c) => c.openRate)
          .filter((n) => n != null && Number.isFinite(n));
        const clickRates = campaigns
          .map((c) => c.clickRate)
          .filter((n) => n != null && Number.isFinite(n));
        const unsubscribes = campaigns.reduce((s, c) => s + (c.unsubscribes || 0), 0);

        const memberCount = await fetchAudienceSize(token, locationId);

        return {
          ok: true,
          available: true,
          provider: 'gohighlevel',
          dateFrom,
          dateTo,
          audience: {
            id: locationId,
            name: String(client.name || 'GoHighLevel location'),
            memberCount: memberCount != null ? memberCount : 0,
          },
          campaigns,
          growth: [],
          totals: {
            campaigns: campaigns.length,
            emailsSent,
            uniqueOpens,
            uniqueClicks,
            avgOpenRate: openRates.length
              ? openRates.reduce((a, b) => a + b, 0) / openRates.length
              : null,
            avgClickRate: clickRates.length
              ? clickRates.reduce((a, b) => a + b, 0) / clickRates.length
              : null,
            unsubscribes,
          },
          ...(listed.ok
            ? {}
            : {
                warning: `Campaign list partially loaded (${listed.error}). Showing stats for campaigns retrieved before the error.`,
              }),
          ...(inRange.length > capped.length
            ? {
                warning: `Showing the ${capped.length} most recent campaigns in range (${inRange.length} matched).`,
              }
            : {}),
        };
      },
    });

    return new Response(JSON.stringify(report), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[portal-gohighlevel]', err);
    return new Response(
      JSON.stringify({
        error: err?.message || 'Could not load GoHighLevel email analytics.',
      }),
      {
        status: err?.status && err.status < 500 ? err.status : 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
};

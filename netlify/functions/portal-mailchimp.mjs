import {
  describeAuthError,
  requireClientOrStaffCaller,
} from './lib/requireAuth.mjs';
import { fetchDoc, getDigestDb } from './lib/firebaseDigestClient.mjs';
import { clientHasActiveEmailRetainer } from './lib/retainerAccess.mjs';

/**
 * Portal/staff Mailchimp analytics proxy.
 * POST { clientId, dateFrom?: YYYY-MM-DD, dateTo?: YYYY-MM-DD }
 */

function parseMailchimpKey(raw) {
  const key = String(raw || '').trim();
  if (!key) return null;
  const dash = key.lastIndexOf('-');
  if (dash <= 0) return null;
  const dc = key.slice(dash + 1).trim();
  if (!dc) return null;
  return { apiKey: key, dc };
}

function ymd(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  return x.toISOString().slice(0, 10);
}

async function mcGet(apiKey, dc, path, params = {}) {
  const url = new URL(`https://${dc}.api.mailchimp.com/3.0${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    url.searchParams.set(k, String(v));
  });
  const resp = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Basic ${Buffer.from(`anystring:${apiKey}`).toString('base64')}`,
      Accept: 'application/json',
    },
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = data?.detail || data?.title || data?.error || `Mailchimp HTTP ${resp.status}`;
    const err = new Error(msg);
    err.status = resp.status;
    throw err;
  }
  return data;
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

    if (!clientHasActiveEmailRetainer(client)) {
      return new Response(
        JSON.stringify({ error: 'Email analytics requires an active Email Marketing retainer.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const creds = parseMailchimpKey(process.env.MAILCHIMP_API_KEY);
    const audienceId = String(client.mailchimpAudienceId || '').trim();
    const dateFrom = String(body.dateFrom || '').trim() || ymd(new Date(Date.now() - 30 * 86400000));
    const dateTo = String(body.dateTo || '').trim() || ymd();

    if (!creds) {
      return new Response(
        JSON.stringify({
          ok: true,
          available: false,
          warning:
            'Mailchimp is not configured yet. Add MAILCHIMP_API_KEY in Netlify (key ending in -usXX).',
          dateFrom,
          dateTo,
          audience: {},
          campaigns: [],
          totals: {},
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!audienceId) {
      return new Response(
        JSON.stringify({
          ok: true,
          available: false,
          warning:
            'No Mailchimp audience ID on this client. Ask Ignite to add mailchimpAudienceId on the CRM profile.',
          dateFrom,
          dateTo,
          audience: {},
          campaigns: [],
          totals: {},
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const list = await mcGet(creds.apiKey, creds.dc, `/lists/${encodeURIComponent(audienceId)}`, {
      fields: 'id,name,stats.member_count',
    });

    // Campaigns for this list; filter by send date in range.
    const campaignsPayload = await mcGet(creds.apiKey, creds.dc, '/campaigns', {
      count: 50,
      offset: 0,
      status: 'sent',
      sort_field: 'send_time',
      sort_dir: 'DESC',
      list_id: audienceId,
      fields:
        'campaigns.id,campaigns.settings.title,campaigns.settings.subject_line,campaigns.send_time,campaigns.emails_sent,campaigns.report_summary',
    });

    const campaigns = (Array.isArray(campaignsPayload.campaigns) ? campaignsPayload.campaigns : [])
      .map((c) => {
        const sendTime = String(c.send_time || '').slice(0, 10);
        const summary = c.report_summary || {};
        return {
          id: String(c.id || ''),
          title: String(c.settings?.title || c.settings?.subject_line || c.id || ''),
          sendDate: sendTime,
          emailsSent: Number(c.emails_sent || summary.emails_sent || 0),
          openRate: summary.open_rate != null ? Number(summary.open_rate) : null,
          clickRate: summary.click_rate != null ? Number(summary.click_rate) : null,
          unsubscribes: Number(summary.unsubscribed || 0),
        };
      })
      .filter((c) => c.sendDate && c.sendDate >= dateFrom && c.sendDate <= dateTo);

    const emailsSent = campaigns.reduce((s, c) => s + (c.emailsSent || 0), 0);
    const openRates = campaigns.map((c) => c.openRate).filter((n) => n != null && Number.isFinite(n));
    const clickRates = campaigns
      .map((c) => c.clickRate)
      .filter((n) => n != null && Number.isFinite(n));
    const unsubscribes = campaigns.reduce((s, c) => s + (c.unsubscribes || 0), 0);

    return new Response(
      JSON.stringify({
        ok: true,
        available: true,
        dateFrom,
        dateTo,
        audience: {
          id: String(list.id || audienceId),
          name: String(list.name || ''),
          memberCount: Number(list.stats?.member_count || 0),
        },
        campaigns,
        totals: {
          campaigns: campaigns.length,
          emailsSent,
          avgOpenRate: openRates.length
            ? openRates.reduce((a, b) => a + b, 0) / openRates.length
            : null,
          avgClickRate: clickRates.length
            ? clickRates.reduce((a, b) => a + b, 0) / clickRates.length
            : null,
          unsubscribes,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[portal-mailchimp]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not load Mailchimp analytics.' }),
      { status: err?.status && err.status < 500 ? err.status : 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

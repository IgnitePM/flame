import {
  describeAuthError,
  requireClientOrStaffCaller,
} from './lib/requireAuth.mjs';
import { fetchDoc, getDigestDb } from './lib/firebaseDigestClient.mjs';
import { clientHasActiveEmailRetainer } from './lib/retainerAccess.mjs';
import { wantsForceRefresh, withAnalyticsCache } from './lib/analyticsReportCache.mjs';

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
  if (!/^[a-z]+\d+$/i.test(dc)) return null;
  return { apiKey: key, dc: dc.toLowerCase() };
}

function ymd(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  return x.toISOString().slice(0, 10);
}

function normalizeAudienceId(raw) {
  // Audience IDs are short alphanumerics; strip spaces/URL junk.
  return String(raw || '')
    .trim()
    .replace(/^.*[/=]/, '')
    .replace(/[^a-zA-Z0-9]/g, '');
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
    err.mailchimp = data;
    throw err;
  }
  return data;
}

async function mcGetSoft(apiKey, dc, path, params = {}) {
  try {
    return { ok: true, data: await mcGet(apiKey, dc, path, params) };
  } catch (err) {
    return {
      ok: false,
      error: err?.message || 'Request failed',
      status: err?.status || 500,
    };
  }
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
        JSON.stringify({ error: 'Email analytics requires an active Email Marketing retainer.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const secrets = await fetchDoc(db, `clientIntegrationSecrets/${clientId}`);
    const creds =
      parseMailchimpKey(secrets?.mailchimpApiKey) ||
      parseMailchimpKey(process.env.MAILCHIMP_API_KEY);
    let audienceId = normalizeAudienceId(client.mailchimpAudienceId);
    const dateFrom = String(body.dateFrom || '').trim() || ymd(new Date(Date.now() - 30 * 86400000));
    const dateTo = String(body.dateTo || '').trim() || ymd();

    if (!creds) {
      return new Response(
        JSON.stringify({
          ok: true,
          available: false,
          warning:
            'No Mailchimp API key for this client. In the CRM, paste the API key from that client’s own Mailchimp account (Account → Extras → API keys).',
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
      // With a valid client key, list audiences so staff can pick the right ID.
      const listsResult = await mcGetSoft(creds.apiKey, creds.dc, '/lists', {
        count: 50,
        fields: 'lists.id,lists.name,lists.stats.member_count',
      });
      const availableLists = listsResult.ok
        ? (Array.isArray(listsResult.data?.lists) ? listsResult.data.lists : []).map((l) => ({
            id: String(l.id || ''),
            name: String(l.name || ''),
            memberCount: Number(l.stats?.member_count || 0),
          }))
        : [];

      if (availableLists.length === 1) {
        audienceId = availableLists[0].id;
      } else {
        return new Response(
          JSON.stringify({
            ok: true,
            available: false,
            warning:
              availableLists.length > 0
                ? 'Mailchimp API key works, but no audience ID is set on this client. Pick one below and save it on the CRM profile.'
                : 'No Mailchimp audience ID on this client. Add mailchimpAudienceId on the CRM profile (Audience → Settings → Audience name and defaults).',
            dateFrom,
            dateTo,
            audience: {},
            availableAudiences: availableLists,
            campaigns: [],
            totals: {},
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }

    const forceRefresh = wantsForceRefresh(body);
    const report = await withAnalyticsCache({
      db,
      source: 'email',
      clientId,
      dateFrom,
      dateTo,
      forceRefresh,
      build: async () => {
    const listResult = await mcGetSoft(
      creds.apiKey,
      creds.dc,
      `/lists/${encodeURIComponent(audienceId)}`,
      { fields: 'id,name,stats.member_count' },
    );

    if (!listResult.ok) {
      const listsResult = await mcGetSoft(creds.apiKey, creds.dc, '/lists', {
        count: 50,
        fields: 'lists.id,lists.name,lists.stats.member_count',
      });
      const availableLists = listsResult.ok
        ? (Array.isArray(listsResult.data?.lists) ? listsResult.data.lists : []).map((l) => ({
            id: String(l.id || ''),
            name: String(l.name || ''),
            memberCount: Number(l.stats?.member_count || 0),
          }))
        : [];

      const hint =
        availableLists.length > 0
          ? ` Available audiences: ${availableLists
              .slice(0, 8)
              .map((l) => `${l.name} (${l.id})`)
              .join('; ')}.`
          : ' Confirm the Audience ID under Audience → Settings → Audience name and defaults (not the ID in the browser URL).';

      return {
        ok: true,
        available: false,
        warning: `Mailchimp could not find audience “${audienceId}”.${hint}`,
        dateFrom,
        dateTo,
        audience: { id: audienceId },
        availableAudiences: availableLists,
        campaigns: [],
        totals: {},
      };
    }

    const list = listResult.data;

    // Prefer Mailchimp send-time filters; also filter client-side as a safety net.
    const campaignsResult = await mcGetSoft(creds.apiKey, creds.dc, '/campaigns', {
      count: 100,
      offset: 0,
      status: 'sent',
      sort_field: 'send_time',
      sort_dir: 'DESC',
      list_id: audienceId,
      since_send_time: `${dateFrom}T00:00:00+00:00`,
      before_send_time: `${dateTo}T23:59:59+00:00`,
    });

    let rawCampaigns = [];
    if (campaignsResult.ok) {
      rawCampaigns = Array.isArray(campaignsResult.data?.campaigns)
        ? campaignsResult.data.campaigns
        : [];
    } else {
      // Fallback without list_id / time filters if the filtered call fails.
      const fallback = await mcGetSoft(creds.apiKey, creds.dc, '/campaigns', {
        count: 100,
        status: 'sent',
        sort_field: 'send_time',
        sort_dir: 'DESC',
      });
      rawCampaigns = fallback.ok
        ? (Array.isArray(fallback.data?.campaigns) ? fallback.data.campaigns : [])
        : [];
    }

    const campaigns = rawCampaigns
      .map((c) => {
        const sendTime = String(c.send_time || '').slice(0, 10);
        const summary = c.report_summary || {};
        const listMatch =
          !c.recipients?.list_id || String(c.recipients.list_id) === audienceId;
        return {
          id: String(c.id || ''),
          title: String(c.settings?.title || c.settings?.subject_line || c.id || ''),
          sendDate: sendTime,
          emailsSent: Number(c.emails_sent || summary.emails_sent || 0),
          openRate: summary.open_rate != null ? Number(summary.open_rate) : null,
          clickRate: summary.click_rate != null ? Number(summary.click_rate) : null,
          unsubscribes: Number(summary.unsubscribed || 0),
          listMatch,
        };
      })
      .filter(
        (c) =>
          c.listMatch &&
          c.sendDate &&
          c.sendDate >= dateFrom &&
          c.sendDate <= dateTo,
      )
      .map(({ listMatch, ...rest }) => rest);

    const emailsSent = campaigns.reduce((s, c) => s + (c.emailsSent || 0), 0);
    const openRates = campaigns.map((c) => c.openRate).filter((n) => n != null && Number.isFinite(n));
    const clickRates = campaigns
      .map((c) => c.clickRate)
      .filter((n) => n != null && Number.isFinite(n));
    const unsubscribes = campaigns.reduce((s, c) => s + (c.unsubscribes || 0), 0);

    return {
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
      ...(campaignsResult.ok
        ? {}
        : {
            warning: `Audience found, but campaign fetch had an issue: ${campaignsResult.error}`,
          }),
    };
      },
    });

    return new Response(JSON.stringify(report), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[portal-mailchimp]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not load Mailchimp analytics.' }),
      {
        status: err?.status && err.status < 500 ? err.status : 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
};

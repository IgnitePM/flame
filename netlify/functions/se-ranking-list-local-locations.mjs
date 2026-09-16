import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';

/**
 * Admin/billing: list SE Ranking Local Marketing locations (for CRM linking).
 * POST → { locations: [{ locationId, displayName, accountName, ... }] }
 */

const SE_LOCAL = 'https://api.seranking.com/v1/local-marketing';

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    await requireStaffCaller(req.headers, { roles: ['admin', 'billing'] });
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
        error: 'Missing SE_RANKING_API_KEY in Netlify environment variables.',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  try {
    const out = [];
    let offset = 0;
    const limit = 100;
    for (let page = 0; page < 20; page++) {
      const url = new URL(`${SE_LOCAL}/locations`);
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('offset', String(offset));
      url.searchParams.set('is_active', 'true');
      const resp = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Authorization: `Token ${apiKey}`,
          Accept: 'application/json',
        },
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(
          data?.message || data?.error || `SE Ranking HTTP ${resp.status}`,
        );
      }
      const items = Array.isArray(data.items) ? data.items : [];
      for (const loc of items) {
        const locationId = String(loc.id || '').replace(/[^\d]/g, '');
        if (!locationId) continue;
        out.push({
          locationId,
          displayName: String(loc.title || locationId),
          accountName: String(loc.account_name || ''),
          connectionStatus: String(loc.connection_status || ''),
          reviewsCount: Number(loc.statistics?.reviews_count) || null,
          averageRating: Number(loc.statistics?.average_rating) || null,
          auditScore: Number(loc.statistics?.audit_score_percent) || null,
        });
      }
      if (items.length < limit) break;
      offset += limit;
    }

    out.sort((a, b) =>
      `${a.accountName} ${a.displayName}`.localeCompare(
        `${b.accountName} ${b.displayName}`,
      ),
    );

    return new Response(JSON.stringify({ ok: true, locations: out }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[se-ranking-list-local-locations]', err);
    return new Response(
      JSON.stringify({
        error: err?.message || 'Could not list SE Ranking Local Marketing locations.',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

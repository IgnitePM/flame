import {
  describeAuthError,
  requireClientOrStaffCaller,
} from './lib/requireAuth.mjs';
import { fetchDoc, getDigestDb } from './lib/firebaseDigestClient.mjs';

/**
 * Portal/staff SEO report proxy for SE Ranking Project API.
 * POST { clientId, dateFrom?: YYYY-MM-DD, dateTo?: YYYY-MM-DD }
 *
 * Uses subscription Project API (not Data API credits) for:
 * summary, visibility/avg position history, keywords, positions.
 */

const SE_API = 'https://api.seranking.com/v1/project-management';

function ymd(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  return x.toISOString().slice(0, 10);
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

function latestPosition(keyword) {
  const positions = Array.isArray(keyword?.positions) ? keyword.positions : [];
  if (!positions.length) return null;
  const sorted = [...positions].sort((a, b) =>
    String(b.date || '').localeCompare(String(a.date || '')),
  );
  return sorted[0] || null;
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

    // Portal users (and staff preview UX) only get SEO when retainer is active.
    if (!clientHasActiveSeoRetainer(client)) {
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

    const [summary, visibilityHistory, avgPosHistory, keywords, positionsGroups] =
      await Promise.all([
        seGet(apiKey, '/sites/summary', { site_id: siteId }),
        seGet(apiKey, '/sites/positions/history', {
          site_id: siteId,
          type: 'visibility_percent',
          date_from: dateFrom,
          date_to: dateTo,
        }),
        seGet(apiKey, '/sites/positions/history', {
          site_id: siteId,
          type: 'avg_pos',
          date_from: dateFrom,
          date_to: dateTo,
        }),
        seGet(apiKey, '/keywords', { site_id: siteId }),
        seGet(apiKey, '/sites/positions', {
          site_id: siteId,
          date_from: dateFrom,
          date_to: dateTo,
        }),
      ]);

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
        keywordRows.push({
          id: String(kw.id),
          name: nameById.get(String(kw.id)) || `Keyword ${kw.id}`,
          position: Number(latest.pos) || 0,
          change: Number(latest.change) || 0,
          volume: Number(kw.volume) || 0,
          date: String(latest.date || ''),
          siteEngineId: engineId ?? null,
        });
      }
    }

    // Prefer best (lowest) position per keyword across engines for the table.
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

    return new Response(
      JSON.stringify({
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
        visibilityTrend: seriesAvgRow(visibilityHistory),
        avgPositionTrend: seriesAvgRow(avgPosHistory),
        keywords: keywordTable,
        keywordCount: keywordTable.length,
        fetchedAt: Date.now(),
        fetchedBy: caller.email,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
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

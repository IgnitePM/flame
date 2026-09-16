import {
  describeAuthError,
  requireClientOrStaffCaller,
} from './lib/requireAuth.mjs';
import { fetchDoc, getDigestDb } from './lib/firebaseDigestClient.mjs';
import { clientHasActiveSocialMediaRetainer } from './lib/retainerAccess.mjs';
import { wantsForceRefresh, withAnalyticsCache } from './lib/analyticsReportCache.mjs';

/**
 * Portal/staff Planable social analytics proxy.
 * POST { clientId, dateFrom?: YYYY-MM-DD, dateTo?: YYYY-MM-DD }
 *
 * Returns page metrics, platform rollups, and top posts for the date range.
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

function ymdFromIso(iso) {
  const s = String(iso || '');
  return s.length >= 10 ? s.slice(0, 10) : '';
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

function normalizePlatform(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ');
  if (!s) return 'Other';
  if (s.includes('instagram') || s === 'ig') return 'Instagram';
  if (s.includes('facebook') || s === 'fb') return 'Facebook';
  if (s.includes('linkedin')) return 'LinkedIn';
  if (s.includes('tiktok')) return 'TikTok';
  if (s.includes('youtube') || s === 'yt') return 'YouTube';
  if (s.includes('twitter') || s === 'x' || s.includes('x.com')) return 'X';
  if (s.includes('threads')) return 'Threads';
  if (s.includes('pinterest')) return 'Pinterest';
  if (s.includes('google')) return 'Google';
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function sumSnapshotMetrics(snapshots) {
  let impressions = 0;
  let reach = 0;
  let engagement = 0;
  let likes = 0;
  let comments = 0;
  let shares = 0;
  let clicks = 0;
  let followers = 0;
  let gainedFollowers = 0;
  for (const snap of snapshots) {
    const platformBlocks = Object.entries(snap || {}).filter(
      ([k, v]) =>
        v &&
        typeof v === 'object' &&
        !['pageId', 'pageType', 'fetchedAt', 'id', 'postId'].includes(k),
    );
    const blocks = platformBlocks.length ? platformBlocks.map(([, b]) => b) : [snap];
    for (const block of blocks) {
      impressions += pickMetric(block, [
        'impressions',
        'impression',
        'views',
        'videoViews',
        'pageImpressions',
      ]);
      reach += pickMetric(block, ['reach', 'uniqueImpressions', 'pageReach']);
      engagement += pickMetric(block, [
        'engagement',
        'engagements',
        'pageEngagedUsers',
      ]);
      likes += pickMetric(block, ['likes', 'reactions', 'likeCount']);
      comments += pickMetric(block, ['comments', 'commentCount', 'replies']);
      shares += pickMetric(block, ['shares', 'reposts', 'retweets', 'shareCount']);
      clicks += pickMetric(block, ['clicks', 'linkClicks', 'pageClicks']);
      const f = pickMetric(block, ['followers', 'pageFans', 'subscribers']);
      if (f > followers) followers = f;
      gainedFollowers += pickMetric(block, [
        'gainedFollowers',
        'followerGrowth',
        'netFollowers',
      ]);
    }
  }
  if (engagement <= 0 && (likes || comments || shares)) {
    engagement = likes + comments + shares;
  }
  return {
    impressions,
    reach,
    engagement,
    likes,
    comments,
    shares,
    clicks,
    followers,
    gainedFollowers,
  };
}

function extractPostMetrics(payload) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  if (!data || typeof data !== 'object') {
    return { impressions: 0, engagement: 0, reactions: 0, reach: 0, likes: 0, comments: 0, shares: 0 };
  }
  const top = {
    impressions: Number(data.impressions || 0),
    engagement: Number(data.engagement || 0),
    reactions: Number(data.reactions || 0),
  };
  const nested = sumSnapshotMetrics([data]);
  return {
    impressions: top.impressions || nested.impressions,
    engagement: top.engagement || nested.engagement,
    reactions: top.reactions || nested.likes,
    reach: nested.reach,
    likes: nested.likes || top.reactions,
    comments: nested.comments,
    shares: nested.shares,
  };
}

function rollupPlatforms(pages) {
  const map = new Map();
  for (const p of pages) {
    const platform = normalizePlatform(p.platform || p.type);
    const prev = map.get(platform) || {
      platform,
      channels: 0,
      impressions: 0,
      reach: 0,
      engagement: 0,
      likes: 0,
      comments: 0,
      shares: 0,
    };
    prev.channels += 1;
    prev.impressions += Number(p.impressions || 0);
    prev.reach += Number(p.reach || 0);
    prev.engagement += Number(p.engagement || 0);
    prev.likes += Number(p.likes || 0);
    prev.comments += Number(p.comments || 0);
    prev.shares += Number(p.shares || 0);
    map.set(platform, prev);
  }
  return [...map.values()].sort((a, b) => b.engagement - a.engagement || b.impressions - a.impressions);
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

    if (!caller?.isStaff && !clientHasActiveSocialMediaRetainer(client)) {
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
          platforms: [],
          topPosts: [],
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
          platforms: [],
          topPosts: [],
          totals: {},
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const forceRefresh = wantsForceRefresh(body);
    const report = await withAnalyticsCache({
      db,
      source: 'social',
      clientId,
      dateFrom,
      dateTo,
      forceRefresh,
      build: async () => {
    const pagesPayload = await planableGet(token, '/pages', {
      workspaceId,
      limit: 50,
    });
    const rawPages = Array.isArray(pagesPayload?.data)
      ? pagesPayload.data
      : Array.isArray(pagesPayload)
        ? pagesPayload
        : [];

    const pageNameById = new Map();
    const pages = [];
    let totalImpressions = 0;
    let totalReach = 0;
    let totalEngagement = 0;
    let totalLikes = 0;
    let totalComments = 0;
    let totalShares = 0;
    let totalFollowers = 0;
    let totalGainedFollowers = 0;

    for (const page of rawPages.slice(0, 25)) {
      const id = String(page.id || page._id || '');
      if (!id) continue;
      const platform = normalizePlatform(page.type || page.pageType || page.platform);
      const name = String(page.name || page.title || page.username || id);
      pageNameById.set(id, { name, platform });

      let metrics = {
        impressions: 0,
        reach: 0,
        engagement: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        clicks: 0,
        followers: 0,
        gainedFollowers: 0,
      };
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
        console.warn('[portal-planable] page metrics', id, err?.message || err);
      }

      totalImpressions += metrics.impressions;
      totalReach += metrics.reach;
      totalEngagement += metrics.engagement;
      totalLikes += metrics.likes;
      totalComments += metrics.comments;
      totalShares += metrics.shares;
      totalFollowers += metrics.followers;
      totalGainedFollowers += metrics.gainedFollowers;

      pages.push({
        id,
        name,
        platform,
        type: platform,
        impressions: metrics.impressions,
        reach: metrics.reach,
        engagement: metrics.engagement,
        likes: metrics.likes,
        comments: metrics.comments,
        shares: metrics.shares,
        clicks: metrics.clicks,
        followers: metrics.followers,
        gainedFollowers: metrics.gainedFollowers,
      });
    }

    const platforms = rollupPlatforms(pages);

    // Top posts: list workspace posts, keep those scheduled/published in range, pull metrics.
    let topPosts = [];
    let postsWarning = '';
    try {
      const postsPayload = await planableGet(token, '/posts', {
        workspaceId,
        limit: 50,
        offset: 0,
      });
      const rawPosts = Array.isArray(postsPayload?.data)
        ? postsPayload.data
        : Array.isArray(postsPayload)
          ? postsPayload
          : [];

      const inRange = rawPosts
        .map((p) => {
          const when = ymdFromIso(p.scheduledAt || p.publishedAt || p.createdAt);
          const status = String(p.status || '').toLowerCase();
          const published =
            status.includes('publish') ||
            status === 'posted' ||
            status === 'sent' ||
            Boolean(p.scheduledAt);
          return {
            id: String(p.id || ''),
            pageId: String(p.pageId || ''),
            text: String(p.plainText || '').trim(),
            status: String(p.status || ''),
            when,
            published,
          };
        })
        .filter((p) => p.id && p.published && p.when && p.when >= dateFrom && p.when <= dateTo)
        .slice(0, 20);

      const scored = [];
      for (const post of inRange) {
        try {
          const metricsPayload = await planableGet(
            token,
            `/posts/${encodeURIComponent(post.id)}/metrics`,
          );
          const m = extractPostMetrics(metricsPayload);
          const pageMeta = pageNameById.get(post.pageId) || {};
          scored.push({
            id: post.id,
            pageId: post.pageId,
            pageName: pageMeta.name || post.pageId || '—',
            platform: normalizePlatform(
              metricsPayload?.data?.pageType || pageMeta.platform || '',
            ),
            text: post.text || '(No caption)',
            date: post.when,
            impressions: m.impressions,
            engagement: m.engagement,
            reactions: m.reactions,
            likes: m.likes,
            comments: m.comments,
            shares: m.shares,
            reach: m.reach,
          });
        } catch (err) {
          console.warn('[portal-planable] post metrics', post.id, err?.message || err);
        }
      }

      topPosts = scored
        .sort((a, b) => b.engagement - a.engagement || b.impressions - a.impressions)
        .slice(0, 12);
    } catch (err) {
      postsWarning = err?.message || 'Could not load post-level metrics.';
      console.warn('[portal-planable] posts', postsWarning);
    }

    return {
      ok: true,
      available: true,
      dateFrom,
      dateTo,
      workspaceId,
      pages,
      platforms,
      topPosts,
      totals: {
        impressions: totalImpressions,
        reach: totalReach,
        engagement: totalEngagement,
        likes: totalLikes,
        comments: totalComments,
        shares: totalShares,
        followers: totalFollowers,
        gainedFollowers: totalGainedFollowers,
      },
      ...(postsWarning ? { warning: postsWarning } : {}),
    };
      },
    });

    return new Response(JSON.stringify(report), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
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

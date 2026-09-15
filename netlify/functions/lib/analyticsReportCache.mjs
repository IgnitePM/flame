/**
 * Short-lived Firestore cache for portal analytics proxies.
 * Reduces SE Ranking / GA4 / Mailchimp / Planable / Ads API usage on repeat views.
 *
 * Collection: portalAnalyticsCache/{source__clientId__from__to}
 * Only the digest bot / staff write via Netlify functions — never expose to portal clients.
 */

import { fetchDoc, mergeDoc } from './firebaseDigestClient.mjs';

const LIVE_TTL_MS = 15 * 60 * 1000;
const PAST_TTL_MS = 6 * 60 * 60 * 1000;
/** Stay under Firestore's ~1 MiB doc limit. */
const MAX_PAYLOAD_BYTES = 850_000;

export function analyticsCacheKey(source, clientId, dateFrom, dateTo) {
  const raw = `${String(source || 'x')}__${String(clientId || '')}__${String(dateFrom || '')}__${String(dateTo || '')}`;
  return raw.replace(/[\/\\#?]/g, '_').slice(0, 700);
}

export function cacheTtlMsForRange(dateTo) {
  const today = new Date().toISOString().slice(0, 10);
  const to = String(dateTo || '').trim();
  // Open-ended / includes today → data still moving; keep cache short.
  if (!to || to >= today) return LIVE_TTL_MS;
  return PAST_TTL_MS;
}

export function wantsForceRefresh(body) {
  return Boolean(body?.forceRefresh || body?.refresh);
}

/**
 * @returns {Promise<object|null>} Cached payload with cached/cachedAt, or null
 */
export async function readAnalyticsCache(db, key, { ttlMs } = {}) {
  if (!db || !key) return null;
  try {
    const docData = await fetchDoc(db, `portalAnalyticsCache/${key}`);
    if (!docData?.payload || typeof docData.payload !== 'object') return null;
    const cachedAt = Number(docData.cachedAt || 0);
    if (!cachedAt) return null;
    const ttl = Number(ttlMs) > 0 ? Number(ttlMs) : LIVE_TTL_MS;
    if (Date.now() - cachedAt > ttl) return null;
    return {
      ...docData.payload,
      cached: true,
      cachedAt,
      cacheAgeSec: Math.round((Date.now() - cachedAt) / 1000),
    };
  } catch (err) {
    console.warn('[analyticsReportCache] read failed', err?.message || err);
    return null;
  }
}

/**
 * Best-effort write. Skips oversized payloads.
 */
export async function writeAnalyticsCache(db, key, payload, { source = '', clientId = '' } = {}) {
  if (!db || !key || !payload || typeof payload !== 'object') return false;
  try {
    const { cached, cachedAt, cacheAgeSec, ...rest } = payload;
    void cached;
    void cachedAt;
    void cacheAgeSec;
    const json = JSON.stringify(rest);
    if (json.length > MAX_PAYLOAD_BYTES) {
      console.warn(
        `[analyticsReportCache] skip write ${key}: payload ${json.length} bytes > ${MAX_PAYLOAD_BYTES}`,
      );
      return false;
    }
    await mergeDoc(db, `portalAnalyticsCache/${key}`, {
      source: String(source || ''),
      clientId: String(clientId || ''),
      cachedAt: Date.now(),
      payload: rest,
      byteLength: json.length,
    });
    return true;
  } catch (err) {
    console.warn('[analyticsReportCache] write failed', err?.message || err);
    return false;
  }
}

/**
 * Try cache, else build + store.
 * @param {object} opts
 * @param {*} opts.db
 * @param {string} opts.source
 * @param {string} opts.clientId
 * @param {string} opts.dateFrom
 * @param {string} opts.dateTo
 * @param {boolean} opts.forceRefresh
 * @param {() => Promise<object>} opts.build
 */
export async function withAnalyticsCache({
  db,
  source,
  clientId,
  dateFrom,
  dateTo,
  forceRefresh = false,
  build,
}) {
  const key = analyticsCacheKey(source, clientId, dateFrom, dateTo);
  const ttlMs = cacheTtlMsForRange(dateTo);

  if (!forceRefresh) {
    const hit = await readAnalyticsCache(db, key, { ttlMs });
    if (hit) return hit;
  }

  const payload = await build();
  if (
    payload &&
    typeof payload === 'object' &&
    !payload.error &&
    (payload.available === undefined || payload.available === true)
  ) {
    await writeAnalyticsCache(db, key, payload, { source, clientId });
  }
  return {
    ...payload,
    cached: false,
    cachedAt: Date.now(),
    cacheAgeSec: 0,
  };
}

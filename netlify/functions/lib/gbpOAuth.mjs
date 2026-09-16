/**
 * Company Google Business Profile OAuth helpers (Performance + Account/Info APIs).
 * Tokens live in Firestore gbpConnections/company; only Netlify (digest bot) touches them.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { fetchDoc, getDigestDb, mergeDoc, removeDoc } from './firebaseDigestClient.mjs';

export const GBP_SCOPES = [
  'https://www.googleapis.com/auth/business.manage',
  'openid',
  'email',
  'profile',
].join(' ');

export const COMPANY_CONNECTION_ID = 'company';

const PERFORMANCE_METRICS = [
  'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
  'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
  'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
  'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
  'WEBSITE_CLICKS',
  'CALL_CLICKS',
  'BUSINESS_DIRECTION_REQUESTS',
  'BUSINESS_PHOTO_VIEWS_MERCHANT',
  'BUSINESS_PHOTO_VIEWS_CUSTOMERS',
];

function oauthConfig() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_GBP_OAUTH_REDIRECT_URI ||
    process.env.GOOGLE_OAUTH_GBP_REDIRECT_URI ||
    '';
  if (!clientId || !clientSecret) {
    throw new Error('Missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET.');
  }
  if (!redirectUri) {
    throw new Error(
      'Missing GOOGLE_GBP_OAUTH_REDIRECT_URI (e.g. https://ignitetimetracker.netlify.app/.netlify/functions/gbp-oauth-callback).',
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export function appBaseUrl() {
  return String(
    process.env.PORTAL_APP_URL ||
      process.env.URL ||
      process.env.DEPLOY_PRIME_URL ||
      'https://ignitetimetracker.netlify.app',
  ).replace(/\/$/, '');
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromB64url(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(b64, 'base64');
}

export function signGbpOAuthState({ uid, email, expMs = Date.now() + 15 * 60 * 1000 }) {
  const { clientSecret } = oauthConfig();
  const payload = b64url(
    JSON.stringify({
      purpose: 'gbp',
      uid: String(uid || ''),
      email: String(email || '').trim().toLowerCase(),
      exp: Number(expMs) || Date.now() + 15 * 60 * 1000,
    }),
  );
  const sig = createHmac('sha256', clientSecret).update(payload).digest();
  return `${payload}.${b64url(sig)}`;
}

export function verifyGbpOAuthState(state) {
  const { clientSecret } = oauthConfig();
  const raw = String(state || '');
  const i = raw.lastIndexOf('.');
  if (i <= 0) throw new Error('Invalid OAuth state.');
  const payload = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  const expected = createHmac('sha256', clientSecret).update(payload).digest();
  const got = fromB64url(sig);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    throw new Error('Invalid OAuth state signature.');
  }
  let data;
  try {
    data = JSON.parse(fromB64url(payload).toString('utf8'));
  } catch {
    throw new Error('Invalid OAuth state payload.');
  }
  if (data?.purpose !== 'gbp') throw new Error('Invalid OAuth state purpose.');
  if (!data?.uid || !data?.email) throw new Error('Invalid OAuth state payload.');
  if (Number(data.exp) < Date.now()) throw new Error('OAuth state expired — try Connect again.');
  return { uid: String(data.uid), email: String(data.email).toLowerCase() };
}

export function buildGbpAuthUrl(state) {
  const { clientId, redirectUri } = oauthConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GBP_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: String(state || ''),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCodeForTokens(code) {
  const { clientId, clientSecret, redirectUri } = oauthConfig();
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: String(code || ''),
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.error_description || data?.error || 'Token exchange failed.');
  }
  return data;
}

export async function refreshAccessToken(refreshToken) {
  const { clientId, clientSecret } = oauthConfig();
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: String(refreshToken || ''),
      grant_type: 'refresh_token',
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.error_description || data?.error || 'Token refresh failed.');
  }
  return data;
}

export async function revokeToken(token) {
  if (!token) return;
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch {
    /* best-effort */
  }
}

export async function fetchGoogleUserEmail(accessToken) {
  const resp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) return '';
  return String(data?.email || '').trim().toLowerCase();
}

export function connectionPath(id = COMPANY_CONNECTION_ID) {
  return `gbpConnections/${String(id || COMPANY_CONNECTION_ID).trim()}`;
}

export async function loadCompanyConnection() {
  const db = await getDigestDb();
  const data = await fetchDoc(db, connectionPath());
  return data ? { id: COMPANY_CONNECTION_ID, ...data } : null;
}

export async function saveCompanyConnection(fields) {
  const db = await getDigestDb();
  await mergeDoc(db, connectionPath(), {
    ...fields,
    id: COMPANY_CONNECTION_ID,
  });
}

export async function deleteCompanyConnection() {
  const db = await getDigestDb();
  await removeDoc(db, connectionPath());
}

export async function getValidGbpAccessToken() {
  const connection = await loadCompanyConnection();
  if (!connection?.refreshToken && !connection?.accessToken) {
    throw new Error(
      'Google Business Profile is not connected. Connect it in Admin → Config.',
    );
  }
  const skew = 60_000;
  const expiry = Number(connection.expiry || 0);
  if (connection.accessToken && expiry > Date.now() + skew) {
    return { accessToken: connection.accessToken, connection };
  }
  if (!connection.refreshToken) {
    throw new Error('GBP connection expired — reconnect in Config.');
  }
  const refreshed = await refreshAccessToken(connection.refreshToken);
  const accessToken = refreshed.access_token;
  const nextExpiry = Date.now() + Number(refreshed.expires_in || 3600) * 1000;
  const patch = {
    accessToken,
    expiry: nextExpiry,
    ...(refreshed.refresh_token ? { refreshToken: refreshed.refresh_token } : {}),
    updatedAt: Date.now(),
  };
  await saveCompanyConnection(patch);
  return {
    accessToken,
    connection: { ...connection, ...patch },
  };
}

/** Accepts "123", "locations/123", or full accounts/.../locations/123. */
export function normalizeGbpLocationId(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const m = s.match(/locations\/(\d+)/i);
  if (m) return m[1];
  return s.replace(/[^\d]/g, '') || '';
}

function ymdParts(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '').trim());
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function sumTimeSeries(multiDailyMetricTimeSeries, metricName) {
  const seriesList = Array.isArray(multiDailyMetricTimeSeries)
    ? multiDailyMetricTimeSeries
    : [];
  let total = 0;
  for (const block of seriesList) {
    const daily = Array.isArray(block?.dailyMetricTimeSeries)
      ? block.dailyMetricTimeSeries
      : [];
    for (const series of daily) {
      if (metricName && String(series?.dailyMetric || '') !== metricName) continue;
      const points = Array.isArray(series?.timeSeries?.datedValues)
        ? series.timeSeries.datedValues
        : [];
      for (const pt of points) {
        const v = Number(pt?.value);
        if (Number.isFinite(v)) total += v;
      }
    }
  }
  return total;
}

function sumMetrics(multiDailyMetricTimeSeries, metricNames) {
  return metricNames.reduce(
    (acc, name) => acc + sumTimeSeries(multiDailyMetricTimeSeries, name),
    0,
  );
}

/**
 * List Business Profile locations visible to the connected Google account.
 */
export async function listGbpLocations(accessToken) {
  const accountsResp = await fetch(
    'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const accountsData = await accountsResp.json().catch(() => ({}));
  if (!accountsResp.ok) {
    throw new Error(
      accountsData?.error?.message ||
        accountsData?.message ||
        `Could not list GBP accounts (HTTP ${accountsResp.status}).`,
    );
  }

  const accounts = Array.isArray(accountsData.accounts) ? accountsData.accounts : [];
  const out = [];

  for (const account of accounts) {
    const accountName = String(account.name || '').trim();
    if (!accountName) continue;
    const accountLabel = String(account.accountName || accountName);
    let pageToken = '';
    do {
      const params = new URLSearchParams({
        readMask: 'name,title,storefrontAddress,metadata',
        pageSize: '100',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const locResp = await fetch(
        `https://mybusinessbusinessinformation.googleapis.com/v1/${encodeURI(accountName)}/locations?${params}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const locData = await locResp.json().catch(() => ({}));
      if (!locResp.ok) {
        throw new Error(
          locData?.error?.message ||
            locData?.message ||
            `Could not list GBP locations (HTTP ${locResp.status}).`,
        );
      }
      for (const loc of Array.isArray(locData.locations) ? locData.locations : []) {
        const locationId = normalizeGbpLocationId(loc.name);
        if (!locationId) continue;
        const addr = loc.storefrontAddress || {};
        const locality = [addr.locality, addr.administrativeArea].filter(Boolean).join(', ');
        out.push({
          locationId,
          displayName: String(loc.title || locationId),
          accountName: accountLabel,
          address: locality || String(addr.addressLines?.[0] || ''),
        });
      }
      pageToken = String(locData.nextPageToken || '');
    } while (pageToken);
  }

  out.sort((a, b) =>
    `${a.accountName} ${a.displayName}`.localeCompare(`${b.accountName} ${b.displayName}`),
  );
  return out;
}

/**
 * Local SEO performance totals for a location + date range (YYYY-MM-DD).
 */
export async function fetchGbpPerformanceReport(accessToken, locationId, dateFrom, dateTo) {
  const id = normalizeGbpLocationId(locationId);
  const start = ymdParts(dateFrom);
  const end = ymdParts(dateTo);
  if (!id) throw new Error('Missing Google Business Profile location ID.');
  if (!start || !end) throw new Error('GBP date range required (YYYY-MM-DD).');

  const params = new URLSearchParams();
  for (const metric of PERFORMANCE_METRICS) {
    params.append('dailyMetrics', metric);
  }
  params.set('dailyRange.startDate.year', String(start.year));
  params.set('dailyRange.startDate.month', String(start.month));
  params.set('dailyRange.startDate.day', String(start.day));
  params.set('dailyRange.endDate.year', String(end.year));
  params.set('dailyRange.endDate.month', String(end.month));
  params.set('dailyRange.endDate.day', String(end.day));

  const resp = await fetch(
    `https://businessprofileperformance.googleapis.com/v1/locations/${encodeURIComponent(id)}:fetchMultiDailyMetricsTimeSeries?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(
      data?.error?.message ||
        data?.message ||
        `GBP performance failed (HTTP ${resp.status}).`,
    );
  }

  const series = data.multiDailyMetricTimeSeries || [];
  const searchViews = sumMetrics(series, [
    'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
    'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
  ]);
  const mapViews = sumMetrics(series, [
    'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
    'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
  ]);
  const websiteClicks = sumMetrics(series, ['WEBSITE_CLICKS']);
  const calls = sumMetrics(series, ['CALL_CLICKS']);
  const directionRequests = sumMetrics(series, ['BUSINESS_DIRECTION_REQUESTS']);
  const photoViews = sumMetrics(series, [
    'BUSINESS_PHOTO_VIEWS_MERCHANT',
    'BUSINESS_PHOTO_VIEWS_CUSTOMERS',
  ]);

  return {
    available: true,
    locationId: id,
    dateFrom: String(dateFrom).trim(),
    dateTo: String(dateTo).trim(),
    totals: {
      searchViews,
      mapViews,
      websiteClicks,
      calls,
      directionRequests,
      photoViews,
      listingViews: searchViews + mapViews,
    },
  };
}

export function publicConnectionStatus(connection) {
  if (!connection?.refreshToken) {
    return {
      connected: false,
      gbpEmail: '',
      connectedAt: null,
      connectedByEmail: '',
    };
  }
  return {
    connected: true,
    gbpEmail: connection.gbpEmail || '',
    connectedAt: Number(connection.connectedAt || 0) || null,
    connectedByEmail: connection.connectedByEmail || '',
  };
}

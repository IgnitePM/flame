/**
 * Company Google Analytics 4 OAuth helpers (Data + Admin APIs, no googleapis package).
 * Tokens live in Firestore ga4Connections/company; only Netlify (digest bot) touches them.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { fetchDoc, getDigestDb, mergeDoc, removeDoc } from './firebaseDigestClient.mjs';

export const GA4_SCOPES = [
  'https://www.googleapis.com/auth/analytics.readonly',
].join(' ');

export const COMPANY_CONNECTION_ID = 'company';

function oauthConfig() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_GA4_OAUTH_REDIRECT_URI ||
    process.env.GOOGLE_OAUTH_GA4_REDIRECT_URI ||
    '';
  if (!clientId || !clientSecret) {
    throw new Error('Missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET.');
  }
  if (!redirectUri) {
    throw new Error(
      'Missing GOOGLE_GA4_OAUTH_REDIRECT_URI (e.g. https://ignitetimetracker.netlify.app/.netlify/functions/ga4-oauth-callback).',
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

export function signGa4OAuthState({ uid, email, expMs = Date.now() + 15 * 60 * 1000 }) {
  const { clientSecret } = oauthConfig();
  const payload = b64url(
    JSON.stringify({
      purpose: 'ga4',
      uid: String(uid || ''),
      email: String(email || '').trim().toLowerCase(),
      exp: Number(expMs) || Date.now() + 15 * 60 * 1000,
    }),
  );
  const sig = createHmac('sha256', clientSecret).update(payload).digest();
  return `${payload}.${b64url(sig)}`;
}

export function verifyGa4OAuthState(state) {
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
  if (data?.purpose !== 'ga4') throw new Error('Invalid OAuth state purpose.');
  if (!data?.uid || !data?.email) throw new Error('Invalid OAuth state payload.');
  if (Number(data.exp) < Date.now()) throw new Error('OAuth state expired — try Connect again.');
  return { uid: String(data.uid), email: String(data.email).toLowerCase() };
}

export function buildGa4AuthUrl(state) {
  const { clientId, redirectUri } = oauthConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GA4_SCOPES,
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
  if (!resp.ok) {
    throw new Error(data?.error?.message || 'Could not load Google profile.');
  }
  return String(data?.email || '').trim().toLowerCase();
}

export function connectionPath(id = COMPANY_CONNECTION_ID) {
  return `ga4Connections/${String(id || COMPANY_CONNECTION_ID).trim()}`;
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

export async function getValidGa4AccessToken() {
  const connection = await loadCompanyConnection();
  if (!connection?.refreshToken && !connection?.accessToken) {
    throw new Error('Google Analytics is not connected. Connect it in Admin → Config.');
  }
  const skew = 60_000;
  const expiry = Number(connection.expiry || 0);
  if (connection.accessToken && expiry > Date.now() + skew) {
    return { accessToken: connection.accessToken, connection };
  }
  if (!connection.refreshToken) {
    throw new Error('GA4 connection expired — reconnect in Config.');
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

export function normalizeGa4PropertyId(raw) {
  const s = String(raw || '')
    .trim()
    .replace(/^properties\//i, '')
    .replace(/[^\d]/g, '');
  return s || '';
}

export async function runGa4Report(accessToken, propertyId, body) {
  const id = normalizeGa4PropertyId(propertyId);
  if (!id) throw new Error('Missing GA4 property ID.');
  const resp = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(id)}:runReport`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(
      data?.error?.message || data?.message || `GA4 report failed (HTTP ${resp.status}).`,
    );
  }
  return data;
}

export async function listGa4Properties(accessToken) {
  const resp = await fetch(
    'https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200',
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(
      data?.error?.message || data?.message || `Could not list GA4 properties (HTTP ${resp.status}).`,
    );
  }
  const out = [];
  for (const account of Array.isArray(data.accountSummaries) ? data.accountSummaries : []) {
    const accountName = String(account.displayName || account.account || 'Account');
    for (const prop of Array.isArray(account.propertySummaries)
      ? account.propertySummaries
      : []) {
      const propertyId = normalizeGa4PropertyId(prop.property);
      if (!propertyId) continue;
      out.push({
        propertyId,
        displayName: String(prop.displayName || propertyId),
        accountName,
      });
    }
  }
  out.sort((a, b) =>
    `${a.accountName} ${a.displayName}`.localeCompare(`${b.accountName} ${b.displayName}`),
  );
  return out;
}

function metricMap(row, metricHeaders) {
  const values = Array.isArray(row?.metricValues) ? row.metricValues : [];
  const out = {};
  metricHeaders.forEach((h, i) => {
    const name = h?.name || `m${i}`;
    out[name] = Number(values[i]?.value);
  });
  return out;
}

/**
 * Sessions / users totals + channel breakdown for a date range (YYYY-MM-DD).
 */
export async function fetchGa4TrafficReport(accessToken, propertyId, dateFrom, dateTo) {
  const startDate = String(dateFrom || '').trim();
  const endDate = String(dateTo || '').trim();
  if (!startDate || !endDate) throw new Error('GA4 date range required.');

  const [totalsRes, channelsRes] = await Promise.all([
    runGa4Report(accessToken, propertyId, {
      dateRanges: [{ startDate, endDate }],
      metrics: [
        { name: 'sessions' },
        { name: 'totalUsers' },
        { name: 'newUsers' },
        { name: 'engagementRate' },
        { name: 'averageSessionDuration' },
      ],
    }),
    runGa4Report(accessToken, propertyId, {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 15,
    }),
  ]);

  const totalHeaders = totalsRes.metricHeaders || [];
  const totalRow = Array.isArray(totalsRes.rows) ? totalsRes.rows[0] : null;
  const totals = totalRow ? metricMap(totalRow, totalHeaders) : {};

  const channelHeaders = channelsRes.metricHeaders || [];
  const channels = (Array.isArray(channelsRes.rows) ? channelsRes.rows : []).map((row) => {
    const channel = String(row?.dimensionValues?.[0]?.value || 'Unassigned');
    const metrics = metricMap(row, channelHeaders);
    return {
      channel,
      sessions: Number(metrics.sessions) || 0,
      users: Number(metrics.totalUsers) || 0,
    };
  });

  const totalSessions = Number(totals.sessions) || 0;

  return {
    available: true,
    propertyId: normalizeGa4PropertyId(propertyId),
    dateFrom: startDate,
    dateTo: endDate,
    sessions: totalSessions,
    users: Number(totals.totalUsers) || 0,
    newUsers: Number(totals.newUsers) || 0,
    engagementRate:
      totals.engagementRate != null && Number.isFinite(Number(totals.engagementRate))
        ? Number(totals.engagementRate) * 100
        : null,
    avgSessionDuration:
      totals.averageSessionDuration != null &&
      Number.isFinite(Number(totals.averageSessionDuration))
        ? Number(totals.averageSessionDuration)
        : null,
    channels: channels.map((c) => ({
      ...c,
      share: totalSessions > 0 ? (c.sessions / totalSessions) * 100 : 0,
    })),
  };
}

export function publicConnectionStatus(connection) {
  if (!connection?.refreshToken) {
    return {
      connected: false,
      ga4Email: '',
      connectedAt: null,
      connectedByEmail: '',
    };
  }
  return {
    connected: true,
    ga4Email: connection.ga4Email || '',
    connectedAt: Number(connection.connectedAt || 0) || null,
    connectedByEmail: connection.connectedByEmail || '',
  };
}

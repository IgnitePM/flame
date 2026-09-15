/**
 * Company Google Ads OAuth helpers (Ads API, no googleapis package).
 * Tokens live in Firestore googleAdsConnections/company; only Netlify (digest-bot) touches them.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { fetchDoc, getDigestDb, mergeDoc, removeDoc } from './firebaseDigestClient.mjs';

export const GOOGLE_ADS_SCOPES = [
  'https://www.googleapis.com/auth/adwords',
  'openid',
  'email',
  'profile',
].join(' ');

export const COMPANY_CONNECTION_ID = 'company';

function apiVersion() {
  // Default to a current Ads API version; override with GOOGLE_ADS_API_VERSION if needed.
  return String(process.env.GOOGLE_ADS_API_VERSION || 'v21').replace(/^\/*/, '');
}

function oauthConfig() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_ADS_OAUTH_REDIRECT_URI ||
    process.env.GOOGLE_OAUTH_ADS_REDIRECT_URI ||
    '';
  if (!clientId || !clientSecret) {
    throw new Error('Missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET.');
  }
  if (!redirectUri) {
    throw new Error(
      'Missing GOOGLE_ADS_OAUTH_REDIRECT_URI (e.g. https://ignitetimetracker.netlify.app/.netlify/functions/google-ads-oauth-callback).',
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export function developerToken() {
  // Optional since Sept 2026: access is tied to the Cloud project behind OAuth.
  // Header is ignored by Google when present; omit when unset.
  return String(process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '').trim();
}

export function loginCustomerId() {
  return String(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '')
    .replace(/[^\d]/g, '')
    .trim();
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

export function signAdsOAuthState({ uid, email, expMs = Date.now() + 15 * 60 * 1000 }) {
  const { clientSecret } = oauthConfig();
  const payload = b64url(
    JSON.stringify({
      purpose: 'google_ads',
      uid: String(uid || ''),
      email: String(email || '').trim().toLowerCase(),
      exp: Number(expMs) || Date.now() + 15 * 60 * 1000,
    }),
  );
  const sig = createHmac('sha256', clientSecret).update(payload).digest();
  return `${payload}.${b64url(sig)}`;
}

export function verifyAdsOAuthState(state) {
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
  if (data?.purpose !== 'google_ads') throw new Error('Invalid OAuth state purpose.');
  if (!data?.uid || !data?.email) throw new Error('Invalid OAuth state payload.');
  if (Number(data.exp) < Date.now()) throw new Error('OAuth state expired — try Connect again.');
  return { uid: String(data.uid), email: String(data.email).toLowerCase() };
}

export function buildAdsAuthUrl(state) {
  const { clientId, redirectUri } = oauthConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_ADS_SCOPES,
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
    // Ads-only tokens may lack profile/email; callers should fall back to OAuth state email.
    return '';
  }
  return String(data?.email || '').trim().toLowerCase();
}

export function connectionPath(id = COMPANY_CONNECTION_ID) {
  return `googleAdsConnections/${String(id || COMPANY_CONNECTION_ID).trim()}`;
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

export async function getValidAdsAccessToken() {
  const connection = await loadCompanyConnection();
  if (!connection?.refreshToken && !connection?.accessToken) {
    throw new Error('Google Ads is not connected. Connect it in Admin → Config.');
  }
  const skew = 60_000;
  const expiry = Number(connection.expiry || 0);
  if (connection.accessToken && expiry > Date.now() + skew) {
    return { accessToken: connection.accessToken, connection };
  }
  if (!connection.refreshToken) {
    throw new Error('Google Ads connection expired — reconnect in Config.');
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

export function normalizeAdsCustomerId(raw) {
  return String(raw || '')
    .replace(/[^\d]/g, '')
    .trim();
}

function adsHeaders(accessToken, { loginCustomerId: loginId } = {}) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
  const token = developerToken();
  if (token) headers['developer-token'] = token;
  const login = normalizeAdsCustomerId(loginId || loginCustomerId());
  if (login) headers['login-customer-id'] = login;
  return headers;
}

export async function listAccessibleCustomers(accessToken) {
  const resp = await fetch(
    `https://googleads.googleapis.com/${apiVersion()}/customers:listAccessibleCustomers`,
    {
      method: 'GET',
      headers: adsHeaders(accessToken),
    },
  );
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(
      data?.error?.message ||
        data?.message ||
        `Could not list Ads customers (HTTP ${resp.status}).`,
    );
  }
  const resourceNames = Array.isArray(data.resourceNames) ? data.resourceNames : [];
  return resourceNames
    .map((rn) => normalizeAdsCustomerId(String(rn).replace(/^customers\//, '')))
    .filter(Boolean)
    .map((customerId) => ({ customerId, descriptiveName: customerId }));
}

export async function searchGoogleAds(accessToken, customerId, query, opts = {}) {
  const id = normalizeAdsCustomerId(customerId);
  if (!id) throw new Error('Missing Google Ads customer ID.');
  const resp = await fetch(
    `https://googleads.googleapis.com/${apiVersion()}/customers/${encodeURIComponent(id)}/googleAds:search`,
    {
      method: 'POST',
      headers: adsHeaders(accessToken, opts),
      body: JSON.stringify({ query: String(query || '') }),
    },
  );
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(
      data?.error?.message ||
        data?.message ||
        `Google Ads search failed (HTTP ${resp.status}).`,
    );
  }
  return Array.isArray(data.results) ? data.results : [];
}

/**
 * Account totals + top campaigns for a date range (YYYY-MM-DD).
 */
export async function fetchAdsReport(accessToken, customerId, dateFrom, dateTo) {
  const startDate = String(dateFrom || '').trim();
  const endDate = String(dateTo || '').trim();
  if (!startDate || !endDate) throw new Error('Ads date range required.');
  const id = normalizeAdsCustomerId(customerId);
  if (!id) throw new Error('Missing Google Ads customer ID.');

  const totalsQuery = `
    SELECT
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.ctr
    FROM customer
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
  `;

  const campaignsQuery = `
    SELECT
      campaign.id,
      campaign.name,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.ctr
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
    LIMIT 25
  `;

  const [totalRows, campaignRows] = await Promise.all([
    searchGoogleAds(accessToken, id, totalsQuery),
    searchGoogleAds(accessToken, id, campaignsQuery),
  ]);

  let impressions = 0;
  let clicks = 0;
  let costMicros = 0;
  let conversions = 0;
  let ctrSum = 0;
  let ctrCount = 0;

  for (const row of totalRows) {
    const m = row.metrics || {};
    impressions += Number(m.impressions || 0);
    clicks += Number(m.clicks || 0);
    costMicros += Number(m.costMicros || m.cost_micros || 0);
    conversions += Number(m.conversions || 0);
    if (m.ctr != null && Number.isFinite(Number(m.ctr))) {
      ctrSum += Number(m.ctr);
      ctrCount += 1;
    }
  }

  const campaignMap = new Map();
  for (const row of campaignRows) {
    const camp = row.campaign || {};
    const m = row.metrics || {};
    const cid = String(camp.id || '');
    if (!cid) continue;
    const prev = campaignMap.get(cid) || {
      id: cid,
      name: String(camp.name || cid),
      impressions: 0,
      clicks: 0,
      costMicros: 0,
      conversions: 0,
      ctr: null,
    };
    prev.impressions += Number(m.impressions || 0);
    prev.clicks += Number(m.clicks || 0);
    prev.costMicros += Number(m.costMicros || m.cost_micros || 0);
    prev.conversions += Number(m.conversions || 0);
    if (m.ctr != null && Number.isFinite(Number(m.ctr))) prev.ctr = Number(m.ctr);
    campaignMap.set(cid, prev);
  }

  const campaigns = [...campaignMap.values()]
    .map((c) => ({
      id: c.id,
      name: c.name,
      impressions: c.impressions,
      clicks: c.clicks,
      spend: c.costMicros / 1_000_000,
      conversions: c.conversions,
      ctr: c.clicks > 0 && c.impressions > 0 ? c.clicks / c.impressions : c.ctr,
    }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 25);

  return {
    available: true,
    customerId: id,
    dateFrom: startDate,
    dateTo: endDate,
    totals: {
      impressions,
      clicks,
      spend: costMicros / 1_000_000,
      conversions,
      ctr:
        impressions > 0
          ? clicks / impressions
          : ctrCount > 0
            ? ctrSum / ctrCount
            : null,
    },
    campaigns,
  };
}

export function publicConnectionStatus(connection) {
  if (!connection?.refreshToken) {
    return {
      connected: false,
      adsEmail: '',
      connectedAt: null,
      connectedByEmail: '',
    };
  }
  return {
    connected: true,
    adsEmail: connection.adsEmail || '',
    connectedAt: Number(connection.connectedAt || 0) || null,
    connectedByEmail: connection.connectedByEmail || '',
  };
}

/**
 * Per-staff Google Calendar OAuth helpers (Calendar API, no googleapis package).
 * Tokens live in Firestore calendarConnections/{uid}; only Netlify (digest bot) touches them.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { fetchDoc, getDigestDb, mergeDoc, removeDoc } from './firebaseDigestClient.mjs';

export const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ');

function oauthConfig() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_CALENDAR_OAUTH_REDIRECT_URI ||
    process.env.GOOGLE_OAUTH_CALENDAR_REDIRECT_URI ||
    '';
  if (!clientId || !clientSecret) {
    throw new Error('Missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET.');
  }
  if (!redirectUri) {
    throw new Error(
      'Missing GOOGLE_CALENDAR_OAUTH_REDIRECT_URI (e.g. https://ignitetimetracker.netlify.app/.netlify/functions/calendar-oauth-callback).',
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

/** Signed OAuth state: uid + staff email + purpose + expiry. */
export function signCalendarOAuthState({
  uid,
  email,
  expMs = Date.now() + 15 * 60 * 1000,
}) {
  const { clientSecret } = oauthConfig();
  const payload = b64url(
    JSON.stringify({
      purpose: 'calendar',
      uid: String(uid || ''),
      email: String(email || '').trim().toLowerCase(),
      exp: Number(expMs) || Date.now() + 15 * 60 * 1000,
    }),
  );
  const sig = createHmac('sha256', clientSecret).update(payload).digest();
  return `${payload}.${b64url(sig)}`;
}

export function verifyCalendarOAuthState(state) {
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
  if (data?.purpose !== 'calendar') throw new Error('Invalid OAuth state purpose.');
  if (!data?.uid || !data?.email) throw new Error('Invalid OAuth state payload.');
  if (Number(data.exp) < Date.now()) throw new Error('OAuth state expired — try Connect again.');
  return { uid: String(data.uid), email: String(data.email).toLowerCase() };
}

export function buildCalendarAuthUrl(state) {
  const { clientId, redirectUri } = oauthConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: CALENDAR_SCOPES,
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
      refresh_token: String(refreshToken || ''),
      client_id: clientId,
      client_secret: clientSecret,
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

export function connectionPath(uid) {
  return `calendarConnections/${String(uid || '').trim()}`;
}

export async function loadConnection(uid) {
  const id = String(uid || '').trim();
  if (!id) return null;
  const db = await getDigestDb();
  const data = await fetchDoc(db, connectionPath(id));
  return data ? { id, ...data } : null;
}

export async function saveConnection(uid, fields) {
  const id = String(uid || '').trim();
  if (!id) throw new Error('uid required');
  const db = await getDigestDb();
  await mergeDoc(db, connectionPath(id), { ...fields, uid: id });
}

export async function deleteConnection(uid) {
  const id = String(uid || '').trim();
  if (!id) return;
  const db = await getDigestDb();
  await removeDoc(db, connectionPath(id));
}

export async function getValidAccessToken(connection) {
  if (!connection?.refreshToken && !connection?.accessToken) {
    throw new Error('Google Calendar is not connected.');
  }
  const skew = 60_000;
  const expiry = Number(connection.expiry || 0);
  if (connection.accessToken && expiry > Date.now() + skew) {
    return connection.accessToken;
  }
  if (!connection.refreshToken) {
    throw new Error('Calendar connection expired — reconnect from the kiosk.');
  }
  const refreshed = await refreshAccessToken(connection.refreshToken);
  const accessToken = refreshed.access_token;
  const nextExpiry = Date.now() + Number(refreshed.expires_in || 3600) * 1000;
  await saveConnection(connection.uid || connection.id, {
    accessToken,
    expiry: nextExpiry,
    ...(refreshed.refresh_token ? { refreshToken: refreshed.refresh_token } : {}),
  });
  return accessToken;
}

/**
 * Upcoming events from the user's primary calendar.
 * @returns {Promise<Array<{ id, title, start, end, allDay, location, htmlLink }>>}
 */
export async function listUpcomingEvents(accessToken, { days = 7, maxResults = 25 } = {}) {
  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + Math.max(1, Number(days) || 7) * 86400000).toISOString();
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(Math.min(50, Math.max(1, Number(maxResults) || 25))),
  });
  const resp = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.error?.message || 'Could not load calendar events.');
  }
  return (Array.isArray(data.items) ? data.items : []).map((ev) => {
    const startRaw = ev.start?.dateTime || ev.start?.date || null;
    const endRaw = ev.end?.dateTime || ev.end?.date || null;
    const allDay = Boolean(ev.start?.date && !ev.start?.dateTime);
    return {
      id: String(ev.id || ''),
      title: String(ev.summary || '(No title)').trim() || '(No title)',
      start: startRaw,
      end: endRaw,
      allDay,
      location: String(ev.location || '').trim(),
      htmlLink: String(ev.htmlLink || '').trim(),
    };
  });
}

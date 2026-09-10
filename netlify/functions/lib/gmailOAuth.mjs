/**
 * Per-staff Gmail OAuth helpers (Gmail API, no googleapis package).
 * Tokens live in Firestore gmailConnections/{uid}; only Netlify (digest bot) touches them.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { fetchDoc, getDigestDb, mergeDoc, removeDoc } from './firebaseDigestClient.mjs';

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
].join(' ');

function oauthConfig() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'Missing GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, or GOOGLE_OAUTH_REDIRECT_URI.',
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

/** Signed OAuth state: uid + staff email + expiry. */
export function signOAuthState({ uid, email, expMs = Date.now() + 15 * 60 * 1000 }) {
  const { clientSecret } = oauthConfig();
  const payload = b64url(
    JSON.stringify({
      uid: String(uid || ''),
      email: String(email || '').trim().toLowerCase(),
      exp: Number(expMs) || Date.now() + 15 * 60 * 1000,
    }),
  );
  const sig = createHmac('sha256', clientSecret).update(payload).digest();
  return `${payload}.${b64url(sig)}`;
}

export function verifyOAuthState(state) {
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
  if (!data?.uid || !data?.email) throw new Error('Invalid OAuth state payload.');
  if (Number(data.exp) < Date.now()) throw new Error('OAuth state expired — try Connect again.');
  return { uid: String(data.uid), email: String(data.email).toLowerCase() };
}

export function buildAuthUrl(state) {
  const { clientId, redirectUri } = oauthConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPES,
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

export async function fetchGmailProfile(accessToken) {
  const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.error?.message || 'Could not load Gmail profile.');
  }
  return data;
}

export function connectionPath(uid) {
  return `gmailConnections/${String(uid || '').trim()}`;
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

/**
 * Ensure a valid access token for this connection; refresh + persist when needed.
 */
export async function getValidAccessToken(connection) {
  if (!connection?.refreshToken && !connection?.accessToken) {
    throw new Error('Gmail is not connected.');
  }
  const skew = 60_000;
  const expiry = Number(connection.expiry || 0);
  if (connection.accessToken && expiry > Date.now() + skew) {
    return connection.accessToken;
  }
  if (!connection.refreshToken) {
    throw new Error('Gmail connection expired — reconnect in Config.');
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

/** RFC 2047-safe simple subject; body as UTF-8 quoted-printable-ish plain + html. */
export function buildRawMimeMessage({
  from,
  to = [],
  subject = '',
  text = '',
  html = '',
  inReplyTo = null,
  references = null,
}) {
  const toHeader = (Array.isArray(to) ? to : [to]).filter(Boolean).join(', ');
  const encodedSubject = /[^\x20-\x7E]/.test(subject)
    ? `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`
    : subject;
  const boundary = `ignite_${Date.now().toString(36)}`;
  const headers = [
    `From: ${from}`,
    `To: ${toHeader}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
  if (references) headers.push(`References: ${references}`);

  const plain = String(text || '');
  const rich =
    html ||
    `<html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a;line-height:1.5;padding:24px;white-space:pre-wrap;">${plain
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')}</body></html>`;

  const raw = [
    ...headers,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    plain,
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    '',
    rich,
    `--${boundary}--`,
  ].join('\r\n');

  return b64url(Buffer.from(raw, 'utf8'));
}

export async function gmailSendMessage(accessToken, { raw, threadId = null }) {
  const body = { raw: String(raw || '') };
  if (threadId) body.threadId = String(threadId);
  const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.error?.message || 'Gmail send failed.');
  }
  return data;
}

export async function gmailGetMessage(accessToken, messageId, format = 'full') {
  const resp = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=${format}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.error?.message || 'Could not load Gmail message.');
  }
  return data;
}

export async function gmailListMessages(accessToken, { q = '', pageToken = '', maxResults = 50 } = {}) {
  const params = new URLSearchParams({ maxResults: String(maxResults) });
  if (q) params.set('q', q);
  if (pageToken) params.set('pageToken', pageToken);
  const resp = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.error?.message || 'Could not list Gmail messages.');
  }
  return data;
}

export async function gmailHistoryList(accessToken, startHistoryId, pageToken = '') {
  const params = new URLSearchParams({
    startHistoryId: String(startHistoryId),
    historyTypes: 'messageAdded',
  });
  if (pageToken) params.set('pageToken', pageToken);
  const resp = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/history?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error(data?.error?.message || 'Gmail history failed.');
    err.status = resp.status;
    err.code = data?.error?.code;
    throw err;
  }
  return data;
}

export function headerValue(headers, name) {
  const want = String(name || '').toLowerCase();
  const list = Array.isArray(headers) ? headers : [];
  const hit = list.find((h) => String(h?.name || '').toLowerCase() === want);
  return hit ? String(hit.value || '') : '';
}

/** Extract email addresses from a From/To/Cc header value. */
export function emailsFromHeader(value) {
  const out = [];
  const re = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const matches = String(value || '').match(re) || [];
  for (const m of matches) {
    const em = m.toLowerCase();
    if (!out.includes(em)) out.push(em);
  }
  return out;
}

function decodeBodyData(data) {
  if (!data) return '';
  try {
    return fromB64url(data).toString('utf8');
  } catch {
    return '';
  }
}

/** Prefer text/plain body from a Gmail message resource. */
export function extractPlainBody(message) {
  const payload = message?.payload;
  if (!payload) return '';
  if (payload.body?.data) return decodeBodyData(payload.body.data);
  const parts = Array.isArray(payload.parts) ? payload.parts : [];
  const plain = parts.find((p) => p.mimeType === 'text/plain' && p.body?.data);
  if (plain) return decodeBodyData(plain.body.data);
  const html = parts.find((p) => p.mimeType === 'text/html' && p.body?.data);
  if (html) {
    return decodeBodyData(html.body.data)
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  for (const p of parts) {
    if (Array.isArray(p.parts)) {
      const nested = extractPlainBody({ payload: p });
      if (nested) return nested;
    }
  }
  return String(message?.snippet || '');
}

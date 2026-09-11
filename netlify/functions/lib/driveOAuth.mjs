/**
 * Company Google Drive OAuth helpers (Drive API, no googleapis package).
 * Tokens live in Firestore driveConnections/company; only Netlify (digest bot) touches them.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import https from 'node:https';
import { fetchDoc, getDigestDb, mergeDoc, removeDoc } from './firebaseDigestClient.mjs';

export const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive'].join(' ');

export const COMPANY_CONNECTION_ID = 'company';
export const SHARED_WITH_CLIENT_FOLDER_NAME = 'Shared with client';

function oauthConfig() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_DRIVE_OAUTH_REDIRECT_URI ||
    process.env.GOOGLE_OAUTH_DRIVE_REDIRECT_URI ||
    '';
  if (!clientId || !clientSecret) {
    throw new Error('Missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET.');
  }
  if (!redirectUri) {
    throw new Error(
      'Missing GOOGLE_DRIVE_OAUTH_REDIRECT_URI (e.g. https://ignitetimetracker.netlify.app/.netlify/functions/drive-oauth-callback).',
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
export function signDriveOAuthState({ uid, email, expMs = Date.now() + 15 * 60 * 1000 }) {
  const { clientSecret } = oauthConfig();
  const payload = b64url(
    JSON.stringify({
      purpose: 'drive',
      uid: String(uid || ''),
      email: String(email || '').trim().toLowerCase(),
      exp: Number(expMs) || Date.now() + 15 * 60 * 1000,
    }),
  );
  const sig = createHmac('sha256', clientSecret).update(payload).digest();
  return `${payload}.${b64url(sig)}`;
}

export function verifyDriveOAuthState(state) {
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
  if (data?.purpose !== 'drive') throw new Error('Invalid OAuth state purpose.');
  if (!data?.uid || !data?.email) throw new Error('Invalid OAuth state payload.');
  if (Number(data.exp) < Date.now()) throw new Error('OAuth state expired — try Connect again.');
  return { uid: String(data.uid), email: String(data.email).toLowerCase() };
}

export function buildDriveAuthUrl(state) {
  const { clientId, redirectUri } = oauthConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: DRIVE_SCOPES,
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
  return `driveConnections/${String(id || COMPANY_CONNECTION_ID).trim()}`;
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

export async function getValidCompanyAccessToken() {
  const connection = await loadCompanyConnection();
  if (!connection?.refreshToken && !connection?.accessToken) {
    throw new Error('Company Google Drive is not connected. Connect it in Admin → Config.');
  }
  const skew = 60_000;
  const expiry = Number(connection.expiry || 0);
  if (connection.accessToken && expiry > Date.now() + skew) {
    return { accessToken: connection.accessToken, connection };
  }
  if (!connection.refreshToken) {
    throw new Error('Drive connection expired — reconnect in Config.');
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

export function folderUrl(folderId) {
  const id = String(folderId || '').trim();
  if (!id) return '';
  return `https://drive.google.com/drive/folders/${id}`;
}

export function fileOpenUrl(fileId) {
  const id = String(fileId || '').trim();
  if (!id) return '';
  return `https://drive.google.com/file/d/${id}/view`;
}

/** Extract a Drive file/folder ID from common Google Drive URL shapes. */
export function parseDriveIdFromUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^[a-zA-Z0-9_-]{10,}$/.test(raw) && !/[/:?]/.test(raw)) return raw;
  try {
    const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    const folderMatch = u.pathname.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (folderMatch) return folderMatch[1];
    const fileMatch = u.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (fileMatch) return fileMatch[1];
    const id = u.searchParams.get('id');
    if (id) return id;
  } catch {
    /* ignore */
  }
  return '';
}

async function driveJson(accessToken, url, { method = 'GET', body = null, headers = {} } = {}) {
  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error(data?.error?.message || `Drive API failed (${resp.status}).`);
    err.status = resp.status;
    err.code = data?.error?.code;
    throw err;
  }
  return data;
}

const FILE_FIELDS =
  'id,name,mimeType,size,modifiedTime,webViewLink,iconLink,thumbnailLink,parents,driveId,shortcutDetails';

function escapeDriveQueryValue(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}

/**
 * Walk parents until rootFolderId is found (or give up). Uses a shared cache map.
 */
async function fileIsUnderRoot(accessToken, file, rootFolderId, cache) {
  const root = String(rootFolderId || '').trim();
  if (!root || !file?.id) return false;
  if (file.id === root) return true;

  let parents = Array.isArray(file.parents) ? [...file.parents] : [];
  const seen = new Set([file.id]);
  let guard = 0;
  while (parents.length && guard < 30) {
    guard += 1;
    if (parents.includes(root)) return true;
    const next = [];
    for (const pid of parents) {
      if (!pid || seen.has(pid)) continue;
      seen.add(pid);
      if (pid === root) return true;
      let meta = cache.get(pid);
      if (!meta) {
        try {
          meta = await driveGetFile(accessToken, pid);
          cache.set(pid, meta);
        } catch {
          cache.set(pid, null);
          continue;
        }
      }
      if (!meta) continue;
      if (meta.id === root) return true;
      const p = Array.isArray(meta.parents) ? meta.parents : [];
      for (const x of p) {
        if (x && !seen.has(x)) next.push(x);
      }
    }
    parents = next;
  }
  return false;
}

/**
 * Search Drive for files under a client folder tree (name + fullText), capped.
 */
export async function driveSearchInTree(
  accessToken,
  { rootFolderId, query, pageSize = 50 } = {},
) {
  const root = String(rootFolderId || '').trim();
  const raw = String(query || '').trim();
  if (!root) throw new Error('rootFolderId required');
  if (!raw) return { files: [] };

  const escaped = escapeDriveQueryValue(raw);
  const q =
    `trashed = false and (name contains '${escaped}' or fullText contains '${escaped}')`;
  const params = new URLSearchParams({
    q,
    corpora: 'allDrives',
    includeItemsFromAllDrives: 'true',
    supportsAllDrives: 'true',
    pageSize: String(Math.min(100, Math.max(pageSize * 2, 40))),
    fields: `nextPageToken,files(${FILE_FIELDS})`,
  });

  const data = await driveJson(
    accessToken,
    `https://www.googleapis.com/drive/v3/files?${params}`,
  );
  const candidates = Array.isArray(data.files) ? data.files : [];
  const cache = new Map();
  const matched = [];
  for (const file of candidates) {
    if (matched.length >= pageSize) break;
    // Direct children of root are always in-tree; shortcut for speed.
    const parents = Array.isArray(file.parents) ? file.parents : [];
    if (parents.includes(root) || file.id === root) {
      matched.push(file);
      continue;
    }
    if (await fileIsUnderRoot(accessToken, file, root, cache)) {
      matched.push(file);
    }
  }
  return { files: matched };
}

export async function driveGetFile(accessToken, fileId) {
  const id = String(fileId || '').trim();
  if (!id) throw new Error('fileId required');
  const params = new URLSearchParams({
    supportsAllDrives: 'true',
    fields: FILE_FIELDS,
  });
  return driveJson(
    accessToken,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?${params}`,
  );
}

export async function driveListChildren(accessToken, folderId, { pageToken = '' } = {}) {
  const parent = String(folderId || '').trim() || 'root';
  const q = `'${parent.replace(/'/g, "\\'")}' in parents and trashed = false`;
  const params = new URLSearchParams({
    q,
    spaces: 'drive',
    corpora: 'allDrives',
    includeItemsFromAllDrives: 'true',
    supportsAllDrives: 'true',
    pageSize: '100',
    orderBy: 'folder,name_natural',
    fields: `nextPageToken,files(${FILE_FIELDS})`,
  });
  if (pageToken) params.set('pageToken', pageToken);
  return driveJson(accessToken, `https://www.googleapis.com/drive/v3/files?${params}`);
}

export async function driveListSharedDrives(accessToken, { pageToken = '' } = {}) {
  const params = new URLSearchParams({
    pageSize: '50',
    fields: 'nextPageToken,drives(id,name)',
  });
  if (pageToken) params.set('pageToken', pageToken);
  return driveJson(accessToken, `https://www.googleapis.com/drive/v3/drives?${params}`);
}

export async function driveCreateFolder(accessToken, { name, parents = [] }) {
  const body = {
    name: String(name || 'Untitled').trim() || 'Untitled',
    mimeType: 'application/vnd.google-apps.folder',
  };
  const parentIds = (Array.isArray(parents) ? parents : [parents])
    .map((p) => String(p || '').trim())
    .filter(Boolean);
  if (parentIds.length) body.parents = parentIds;
  const params = new URLSearchParams({
    supportsAllDrives: 'true',
    fields: FILE_FIELDS,
  });
  return driveJson(
    accessToken,
    `https://www.googleapis.com/drive/v3/files?${params}`,
    { method: 'POST', body },
  );
}

export async function driveFindChildFolder(accessToken, parentId, folderName) {
  const parent = String(parentId || '').trim();
  const name = String(folderName || '').trim();
  if (!parent || !name) return null;
  const escaped = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const q =
    `'${parent.replace(/'/g, "\\'")}' in parents and trashed = false and ` +
    `mimeType = 'application/vnd.google-apps.folder' and name = '${escaped}'`;
  const params = new URLSearchParams({
    q,
    corpora: 'allDrives',
    includeItemsFromAllDrives: 'true',
    supportsAllDrives: 'true',
    pageSize: '5',
    fields: `files(${FILE_FIELDS})`,
  });
  const data = await driveJson(accessToken, `https://www.googleapis.com/drive/v3/files?${params}`);
  return Array.isArray(data.files) && data.files[0] ? data.files[0] : null;
}

export async function driveEnsureNamedFolder(accessToken, parentId, folderName) {
  const existing = await driveFindChildFolder(accessToken, parentId, folderName);
  if (existing) return existing;
  return driveCreateFolder(accessToken, { name: folderName, parents: [parentId] });
}

/**
 * Start a resumable upload session. Client PUTs the file bytes to the returned URL
 * (avoids Netlify request body size limits).
 *
 * `origin` must be the browser page origin so Google's upload URL allows CORS PUTs.
 * Uses https.request because Node fetch forbids setting the Origin header.
 */
export async function driveStartResumableUpload(
  accessToken,
  { name, mimeType, parents = [], sizeBytes = null, origin = '' },
) {
  const params = new URLSearchParams({
    uploadType: 'resumable',
    supportsAllDrives: 'true',
    fields: FILE_FIELDS,
  });
  const meta = {
    name: String(name || 'file').trim() || 'file',
  };
  const parentIds = (Array.isArray(parents) ? parents : [parents])
    .map((p) => String(p || '').trim())
    .filter(Boolean);
  if (parentIds.length) meta.parents = parentIds;
  if (mimeType) meta.mimeType = mimeType;

  const body = JSON.stringify(meta);
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json; charset=UTF-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Upload-Content-Type': mimeType || 'application/octet-stream',
  };
  if (sizeBytes != null && Number(sizeBytes) >= 0) {
    headers['X-Upload-Content-Length'] = String(Number(sizeBytes));
  }
  const originHeader = String(origin || '').trim();
  if (originHeader) headers.Origin = originHeader;

  const uploadUrl = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'POST',
        hostname: 'www.googleapis.com',
        path: `/upload/drive/v3/files?${params}`,
        headers,
      },
      (resp) => {
        const chunks = [];
        resp.on('data', (c) => chunks.push(c));
        resp.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          if (resp.statusCode < 200 || resp.statusCode >= 300) {
            let message = 'Could not start Drive upload.';
            try {
              message = JSON.parse(raw)?.error?.message || message;
            } catch {
              /* ignore */
            }
            reject(new Error(message));
            return;
          }
          const location =
            resp.headers.location ||
            resp.headers.Location ||
            (Array.isArray(resp.headers.location) ? resp.headers.location[0] : '');
          if (!location) {
            reject(new Error('No resumable upload URL returned.'));
            return;
          }
          resolve(String(location));
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  return uploadUrl;
}

export async function driveCreatePermission(accessToken, fileId, { email, role = 'reader', type = 'user' }) {
  const id = String(fileId || '').trim();
  if (!id) throw new Error('fileId required');
  const params = new URLSearchParams({
    supportsAllDrives: 'true',
    sendNotificationEmail: 'true',
    fields: 'id,type,role,emailAddress',
  });
  return driveJson(
    accessToken,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}/permissions?${params}`,
    {
      method: 'POST',
      body: {
        type: String(type || 'user'),
        role: String(role || 'reader'),
        emailAddress: String(email || '').trim().toLowerCase(),
      },
    },
  );
}

export function publicConnectionStatus(connection) {
  if (!connection?.refreshToken) {
    return {
      connected: false,
      driveEmail: '',
      connectedAt: null,
      connectedByEmail: '',
      rootFolderId: '',
      rootFolderName: '',
      sharedDriveId: '',
    };
  }
  return {
    connected: true,
    driveEmail: connection.driveEmail || '',
    connectedAt: Number(connection.connectedAt || 0) || null,
    connectedByEmail: connection.connectedByEmail || '',
    rootFolderId: connection.rootFolderId || '',
    rootFolderName: connection.rootFolderName || '',
    sharedDriveId: connection.sharedDriveId || '',
  };
}

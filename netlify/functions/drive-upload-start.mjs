import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import { driveStartResumableUpload, getValidCompanyAccessToken } from './lib/driveOAuth.mjs';

/**
 * Staff: start a resumable Drive upload into a folder.
 * Client then PUTs the file bytes to uploadUrl (Google), avoiding Netlify body limits.
 * POST { folderId, name, mimeType?, sizeBytes? } → { uploadUrl }
 */
export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    await requireStaffCaller(req.headers);
  } catch (err) {
    const { status, message } = describeAuthError(err);
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  try {
    const folderId = String(body.folderId || '').trim();
    const name = String(body.name || '').trim();
    if (!folderId || !name) {
      return new Response(JSON.stringify({ error: 'folderId and name are required.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const { accessToken } = await getValidCompanyAccessToken();
    const origin =
      String(body.origin || '').trim() ||
      String(req.headers.get('origin') || req.headers.get('Origin') || '').trim() ||
      String(process.env.URL || process.env.DEPLOY_PRIME_URL || '').replace(/\/$/, '');
    const uploadUrl = await driveStartResumableUpload(accessToken, {
      name,
      mimeType: String(body.mimeType || 'application/octet-stream'),
      parents: [folderId],
      sizeBytes: body.sizeBytes != null ? Number(body.sizeBytes) : null,
      origin,
    });
    return new Response(JSON.stringify({ ok: true, uploadUrl }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[drive-upload-start]', err);
    return new Response(JSON.stringify({ error: err?.message || 'Could not start upload.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

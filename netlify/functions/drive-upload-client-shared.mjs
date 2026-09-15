import { describeAuthError, requireClientOrStaffCaller } from './lib/requireAuth.mjs';
import { fetchDoc, getDigestDb } from './lib/firebaseDigestClient.mjs';
import { driveStartResumableUpload, getValidCompanyAccessToken } from './lib/driveOAuth.mjs';

/**
 * Portal (or staff): start a resumable Drive upload into the client's
 * "Shared with client" folder only. Clients cannot choose another folder.
 * POST { clientId, name, mimeType?, sizeBytes?, origin? } → { uploadUrl, folderId }
 */
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
    const name = String(body.name || '').trim();
    if (!clientId || !name) {
      return new Response(
        JSON.stringify({ error: 'clientId and name are required.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const db = await getDigestDb();
    const client = await fetchDoc(db, `clients/${clientId}`);
    if (!client) {
      return new Response(JSON.stringify({ error: 'Client not found.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const sharedFolderId = String(client.googleDriveSharedFolderId || '').trim();
    if (!sharedFolderId) {
      return new Response(
        JSON.stringify({
          error:
            'No shared folder is set up for this client yet. Ask Ignite to open Files in the CRM first.',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const { accessToken } = await getValidCompanyAccessToken();
    const origin =
      String(body.origin || '').trim() ||
      String(req.headers.get('origin') || req.headers.get('Origin') || '').trim() ||
      String(process.env.URL || process.env.DEPLOY_PRIME_URL || '').replace(/\/$/, '');

    const uploadUrl = await driveStartResumableUpload(accessToken, {
      name,
      mimeType: String(body.mimeType || 'application/octet-stream'),
      parents: [sharedFolderId],
      sizeBytes: body.sizeBytes != null ? Number(body.sizeBytes) : null,
      origin,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        uploadUrl,
        folderId: sharedFolderId,
        uploadedBy: caller.email || '',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[drive-upload-client-shared]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not start upload.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

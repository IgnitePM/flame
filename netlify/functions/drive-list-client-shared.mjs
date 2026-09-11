import { describeAuthError, requireClientOrStaffCaller } from './lib/requireAuth.mjs';
import { fetchDoc, getDigestDb } from './lib/firebaseDigestClient.mjs';
import { driveGetFile, driveListChildren, getValidCompanyAccessToken } from './lib/driveOAuth.mjs';

/**
 * Portal (or staff): list only the client's "Shared with client" Drive folder.
 * POST { clientId, pageToken?, folderId? }
 * folderId must be the shared folder or a descendant (validated by parent walk limited to shared root).
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
  try {
    await requireClientOrStaffCaller(req.headers, clientId);
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

    const sharedFolderId = String(client.googleDriveSharedFolderId || '').trim();
    if (!sharedFolderId) {
      return new Response(
        JSON.stringify({
          ok: true,
          folder: null,
          files: [],
          emptyReason: 'no_shared_folder',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const requestedId = String(body.folderId || '').trim() || sharedFolderId;
    // Only allow listing the shared root (no arbitrary folderId browsing outside it).
    if (requestedId !== sharedFolderId) {
      return new Response(
        JSON.stringify({ error: 'You can only browse the shared client folder.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const { accessToken } = await getValidCompanyAccessToken();
    const [folder, listed] = await Promise.all([
      driveGetFile(accessToken, sharedFolderId),
      driveListChildren(accessToken, sharedFolderId, {
        pageToken: String(body.pageToken || ''),
      }),
    ]);

    return new Response(
      JSON.stringify({
        ok: true,
        folder: {
          id: folder.id,
          name: folder.name,
          webViewLink: folder.webViewLink || null,
        },
        files: Array.isArray(listed.files) ? listed.files : [],
        nextPageToken: listed.nextPageToken || null,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[drive-list-client-shared]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not list shared files.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

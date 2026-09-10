import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import { fetchDoc, getDigestDb, mergeDoc } from './lib/firebaseDigestClient.mjs';
import {
  driveEnsureNamedFolder,
  driveGetFile,
  folderUrl,
  getValidCompanyAccessToken,
  parseDriveIdFromUrl,
  SHARED_WITH_CLIENT_FOLDER_NAME,
} from './lib/driveOAuth.mjs';

/**
 * Staff: link an existing Drive folder URL/ID to a client; ensure Shared with client/.
 * POST { clientId, folderUrl | folderId }
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
    const clientId = String(body.clientId || '').trim();
    const folderId =
      String(body.folderId || '').trim() || parseDriveIdFromUrl(body.folderUrl || '');
    if (!clientId || !folderId) {
      return new Response(
        JSON.stringify({ error: 'clientId and folderUrl (or folderId) are required.' }),
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

    const { accessToken } = await getValidCompanyAccessToken();
    const folder = await driveGetFile(accessToken, folderId);
    if (folder.mimeType !== 'application/vnd.google-apps.folder') {
      return new Response(JSON.stringify({ error: 'That Drive ID is not a folder.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const shared = await driveEnsureNamedFolder(
      accessToken,
      folder.id,
      SHARED_WITH_CLIENT_FOLDER_NAME,
    );

    const patch = {
      googleDriveFolderId: folder.id,
      googleDriveFolderUrl: folderUrl(folder.id),
      googleDriveSharedFolderId: shared.id,
      googleDriveSharedFolderUrl: folderUrl(shared.id),
      updatedAt: Date.now(),
    };
    await mergeDoc(db, `clients/${clientId}`, patch);

    return new Response(
      JSON.stringify({
        ok: true,
        folderId: folder.id,
        folderName: folder.name,
        sharedFolderId: shared.id,
        folderUrl: patch.googleDriveFolderUrl,
        sharedFolderUrl: patch.googleDriveSharedFolderUrl,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[drive-link-folder]', err);
    return new Response(JSON.stringify({ error: err?.message || 'Could not link Drive folder.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

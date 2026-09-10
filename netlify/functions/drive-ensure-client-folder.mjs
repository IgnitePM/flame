import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import { fetchDoc, getDigestDb, mergeDoc } from './lib/firebaseDigestClient.mjs';
import {
  driveEnsureNamedFolder,
  folderUrl,
  getValidCompanyAccessToken,
  loadCompanyConnection,
  SHARED_WITH_CLIENT_FOLDER_NAME,
} from './lib/driveOAuth.mjs';

/**
 * Staff: create {Client Name}/ + Shared with client/ under company root; save IDs on client.
 * POST { clientId, clientName? }
 */
export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let caller;
  try {
    caller = await requireStaffCaller(req.headers);
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
    if (!clientId) {
      return new Response(JSON.stringify({ error: 'clientId is required.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const db = await getDigestDb();
    const client = await fetchDoc(db, `clients/${clientId}`);
    if (!client) {
      return new Response(JSON.stringify({ error: 'Client not found.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Already linked — ensure Shared subfolder exists, return current.
    if (client.googleDriveFolderId) {
      const { accessToken } = await getValidCompanyAccessToken();
      const shared =
        (await driveEnsureNamedFolder(
          accessToken,
          client.googleDriveFolderId,
          SHARED_WITH_CLIENT_FOLDER_NAME,
        )) || null;
      const patch = {
        googleDriveFolderUrl: folderUrl(client.googleDriveFolderId),
        googleDriveSharedFolderId: shared?.id || client.googleDriveSharedFolderId || '',
        googleDriveSharedFolderUrl: shared?.id
          ? folderUrl(shared.id)
          : client.googleDriveSharedFolderUrl || '',
        updatedAt: Date.now(),
      };
      await mergeDoc(db, `clients/${clientId}`, patch);
      return new Response(
        JSON.stringify({
          ok: true,
          alreadyLinked: true,
          folderId: client.googleDriveFolderId,
          sharedFolderId: patch.googleDriveSharedFolderId,
          folderUrl: patch.googleDriveFolderUrl,
          sharedFolderUrl: patch.googleDriveSharedFolderUrl,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const conn = await loadCompanyConnection();
    const rootFolderId = String(conn?.rootFolderId || '').trim();
    if (!rootFolderId) {
      return new Response(
        JSON.stringify({
          error: 'Company Drive root is not set. Pick a Shared Drive or folder in Config.',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const { accessToken } = await getValidCompanyAccessToken();
    const clientName =
      String(body.clientName || client.name || '').trim() || 'Untitled client';
    const folder = await driveEnsureNamedFolder(accessToken, rootFolderId, clientName);
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
        alreadyLinked: false,
        folderId: folder.id,
        sharedFolderId: shared.id,
        folderUrl: patch.googleDriveFolderUrl,
        sharedFolderUrl: patch.googleDriveSharedFolderUrl,
        createdBy: caller.email,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[drive-ensure-client-folder]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not create client Drive folder.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import { fetchDoc, getDigestDb, mergeDoc } from './lib/firebaseDigestClient.mjs';
import {
  driveEnsureNamedFolder,
  ensureSharedFolderAccessForClient,
  folderUrl,
  getValidCompanyAccessToken,
  portalEmailsFromClient,
  SHARED_WITH_CLIENT_FOLDER_NAME,
} from './lib/driveOAuth.mjs';

/**
 * Staff: share the client's "Shared with client" subfolder with email(s).
 * Does not grant access to the parent client folder or company Shared Drive.
 * POST { clientId, emails?: string[] | string, role?: 'reader'|'commenter'|'writer' }
 * When emails are omitted, shares with all clients.clientEmails portal contacts.
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
    if (!clientId) {
      return new Response(JSON.stringify({ error: 'clientId is required.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const role = ['reader', 'commenter', 'writer'].includes(String(body.role || ''))
      ? String(body.role)
      : 'reader';

    const db = await getDigestDb();
    const client = await fetchDoc(db, `clients/${clientId}`);
    if (!client) {
      return new Response(JSON.stringify({ error: 'Client not found.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!client.googleDriveFolderId) {
      return new Response(
        JSON.stringify({ error: 'Client has no Drive folder linked yet.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const { accessToken } = await getValidCompanyAccessToken();
    let sharedFolderId = String(client.googleDriveSharedFolderId || '').trim();
    if (!sharedFolderId) {
      const shared = await driveEnsureNamedFolder(
        accessToken,
        client.googleDriveFolderId,
        SHARED_WITH_CLIENT_FOLDER_NAME,
      );
      sharedFolderId = shared.id;
      await mergeDoc(db, `clients/${clientId}`, {
        googleDriveSharedFolderId: sharedFolderId,
        googleDriveSharedFolderUrl: folderUrl(sharedFolderId),
        updatedAt: Date.now(),
      });
    }

    const emailsRaw = Array.isArray(body.emails)
      ? body.emails
      : body.emails || body.email
        ? [body.emails || body.email]
        : null;
    const emails =
      emailsRaw == null
        ? portalEmailsFromClient(client)
        : emailsRaw
            .map((e) => String(e || '').trim().toLowerCase())
            .filter((e) => e.includes('@'));

    if (!emails.length) {
      return new Response(
        JSON.stringify({
          error:
            'No emails to share with. Add Authorized Emails on the client, or pass emails in the request.',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const share = await ensureSharedFolderAccessForClient(
      accessToken,
      client,
      sharedFolderId,
      {
        role,
        // Manual share from CRM — notify contacts once.
        sendNotificationEmail: body.sendNotificationEmail !== false,
        emails,
      },
    );

    return new Response(
      JSON.stringify({
        ok: true,
        sharedFolderId,
        sharedFolderUrl: folderUrl(sharedFolderId),
        results: share.results || [],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[drive-share-client-folder]', err);
    return new Response(JSON.stringify({ error: err?.message || 'Could not share folder.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

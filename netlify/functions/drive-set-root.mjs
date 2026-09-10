import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import {
  driveGetFile,
  driveListSharedDrives,
  getValidCompanyAccessToken,
  saveCompanyConnection,
} from './lib/driveOAuth.mjs';

/**
 * Admin/billing: set the company Drive root (Shared Drive id or folder id).
 * POST { rootFolderId, rootFolderName?, sharedDriveId? }
 */
export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    await requireStaffCaller(req.headers, { roles: ['admin', 'billing'] });
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
    const { accessToken } = await getValidCompanyAccessToken();
    const rootFolderId = String(body.rootFolderId || '').trim();
    if (!rootFolderId) {
      return new Response(JSON.stringify({ error: 'rootFolderId is required.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let rootFolderName = String(body.rootFolderName || '').trim();
    let sharedDriveId = String(body.sharedDriveId || '').trim();

    if (rootFolderId === 'root') {
      rootFolderName = rootFolderName || 'My Drive';
      sharedDriveId = '';
    } else {
      // May be a Shared Drive id (also its root folder) or a regular folder.
      try {
        const drives = await driveListSharedDrives(accessToken);
        const hit = (drives.drives || []).find((d) => d.id === rootFolderId);
        if (hit) {
          rootFolderName = hit.name || rootFolderName || 'Shared Drive';
          sharedDriveId = hit.id;
        }
      } catch {
        /* ignore — fall through to file get */
      }
      if (!sharedDriveId || !rootFolderName) {
        const file = await driveGetFile(accessToken, rootFolderId);
        rootFolderName = rootFolderName || file.name || 'Drive folder';
        if (file.driveId) sharedDriveId = file.driveId;
      }
    }

    await saveCompanyConnection({
      rootFolderId,
      rootFolderName,
      sharedDriveId: sharedDriveId || '',
      updatedAt: Date.now(),
    });

    return new Response(
      JSON.stringify({
        ok: true,
        rootFolderId,
        rootFolderName,
        sharedDriveId: sharedDriveId || '',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[drive-set-root]', err);
    return new Response(JSON.stringify({ error: err?.message || 'Could not set Drive root.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import {
  driveListChildren,
  driveListSharedDrives,
  getValidCompanyAccessToken,
  loadCompanyConnection,
} from './lib/driveOAuth.mjs';

/**
 * Admin/billing: list Shared Drives + optional children of a folder (for root picker).
 * POST { folderId? } → { drives, files, root... }
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
    const conn = await loadCompanyConnection();
    const folderId = String(body.folderId || '').trim();

    const drivesResp = await driveListSharedDrives(accessToken);
    const drives = Array.isArray(drivesResp.drives) ? drivesResp.drives : [];

    let files = [];
    if (folderId) {
      const listed = await driveListChildren(accessToken, folderId);
      files = Array.isArray(listed.files) ? listed.files : [];
    }

    return new Response(
      JSON.stringify({
        ok: true,
        drives,
        files,
        myDrive: { id: 'root', name: 'My Drive' },
        rootFolderId: conn?.rootFolderId || '',
        rootFolderName: conn?.rootFolderName || '',
        sharedDriveId: conn?.sharedDriveId || '',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[drive-list-roots]', err);
    return new Response(JSON.stringify({ error: err?.message || 'Could not list Drive roots.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

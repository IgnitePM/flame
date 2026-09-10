import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import { driveGetFile, driveListChildren, getValidCompanyAccessToken } from './lib/driveOAuth.mjs';

/**
 * Staff: list children of a Drive folder (client cabinet browse).
 * POST { folderId, pageToken? }
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
    if (!folderId) {
      return new Response(JSON.stringify({ error: 'folderId is required.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const { accessToken } = await getValidCompanyAccessToken();
    const [folder, listed] = await Promise.all([
      driveGetFile(accessToken, folderId),
      driveListChildren(accessToken, folderId, {
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
    console.error('[drive-list]', err);
    return new Response(JSON.stringify({ error: err?.message || 'Could not list Drive files.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

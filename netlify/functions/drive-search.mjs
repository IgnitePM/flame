import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import { driveSearchInTree, getValidCompanyAccessToken } from './lib/driveOAuth.mjs';

/**
 * Staff: search files under a client Drive folder tree.
 * POST { folderId, query } → { files }
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
    const query = String(body.query || '').trim();
    if (!folderId) {
      return new Response(JSON.stringify({ error: 'folderId is required.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!query) {
      return new Response(JSON.stringify({ ok: true, files: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { accessToken } = await getValidCompanyAccessToken();
    const result = await driveSearchInTree(accessToken, {
      rootFolderId: folderId,
      query,
      pageSize: 50,
    });
    return new Response(JSON.stringify({ ok: true, files: result.files || [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[drive-search]', err);
    return new Response(JSON.stringify({ error: err?.message || 'Drive search failed.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

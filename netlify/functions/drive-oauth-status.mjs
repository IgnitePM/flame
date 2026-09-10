import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import { loadCompanyConnection, publicConnectionStatus } from './lib/driveOAuth.mjs';

/**
 * Staff: company Drive connection status (no tokens).
 * POST → { connected, driveEmail, rootFolderId, ... }
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

  try {
    const conn = await loadCompanyConnection();
    return new Response(JSON.stringify({ ok: true, ...publicConnectionStatus(conn) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[drive-oauth-status]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not load Drive status.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import {
  deleteCompanyConnection,
  loadCompanyConnection,
  revokeToken,
} from './lib/driveOAuth.mjs';

/**
 * Admin/billing: disconnect company Google Drive.
 * POST → { ok: true }
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

  try {
    const conn = await loadCompanyConnection();
    if (conn) {
      await revokeToken(conn.refreshToken || conn.accessToken);
      await deleteCompanyConnection();
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[drive-oauth-disconnect]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not disconnect Drive.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

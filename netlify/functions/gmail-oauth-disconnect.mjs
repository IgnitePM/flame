import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import { deleteConnection, loadConnection, revokeToken } from './lib/gmailOAuth.mjs';

/**
 * Admin/billing: disconnect Gmail for the signed-in caller.
 * POST → { ok: true }
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
    caller = await requireStaffCaller(req.headers, { roles: ['admin', 'billing'] });
  } catch (err) {
    const { status, message } = describeAuthError(err);
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const conn = await loadConnection(caller.uid);
    if (conn) {
      await revokeToken(conn.refreshToken || conn.accessToken);
      await deleteConnection(caller.uid);
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[gmail-oauth-disconnect]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not disconnect Gmail.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

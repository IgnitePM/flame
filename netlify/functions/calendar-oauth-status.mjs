import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import { loadConnection } from './lib/calendarOAuth.mjs';

/**
 * Any staff: Calendar connection status for the signed-in caller (no tokens).
 * POST → { connected, calendarEmail, connectedAt }
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

  try {
    const conn = await loadConnection(caller.uid);
    const connected = Boolean(conn?.refreshToken);
    return new Response(
      JSON.stringify({
        ok: true,
        connected,
        calendarEmail: connected ? conn.calendarEmail || conn.staffEmail || '' : '',
        connectedAt: connected ? Number(conn.connectedAt || 0) || null : null,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[calendar-oauth-status]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not load Calendar status.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import { loadCompanyConnection, publicConnectionStatus } from './lib/gbpOAuth.mjs';

/**
 * Admin/billing: GBP connection status (no tokens).
 * POST → { connected, gbpEmail, connectedAt, connectedByEmail }
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
    return new Response(JSON.stringify({ ok: true, ...publicConnectionStatus(conn) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[gbp-oauth-status]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not load GBP status.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

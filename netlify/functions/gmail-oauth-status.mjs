import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import { loadConnection } from './lib/gmailOAuth.mjs';

/**
 * Admin/billing: Gmail connection status for the signed-in caller (no tokens).
 * POST → { connected, gmailEmail, lastSyncAt, connectedAt }
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
    const connected = Boolean(conn?.refreshToken);
    return new Response(
      JSON.stringify({
        ok: true,
        connected,
        gmailEmail: connected ? conn.gmailEmail || '' : '',
        lastSyncAt: connected ? Number(conn.lastSyncAt || 0) || null : null,
        connectedAt: connected ? Number(conn.connectedAt || 0) || null : null,
        fullSync: connected && conn.fullSync
          ? {
              status: conn.fullSync.status || null,
              scanned: Number(conn.fullSync.scanned || 0),
              upserted: Number(conn.fullSync.upserted || 0),
              chunkIndex: Number(conn.fullSync.chunkIndex || 0),
              totalChunks: Number(conn.fullSync.totalChunks || 0),
            }
          : null,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[gmail-oauth-status]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not load Gmail status.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

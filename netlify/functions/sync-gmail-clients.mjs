import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import { syncAllGmailConnections, syncGmailConnection } from './lib/gmailSync.mjs';

/**
 * Sync Gmail → clientEmailMessages.
 * - Netlify schedule: sync all connections
 * - POST + staff auth: sync caller's connection only ("Sync now")
 */
function isScheduled(req) {
  const h =
    typeof req.headers?.get === 'function'
      ? req.headers.get('x-netlify-event') || req.headers.get('x-nf-event')
      : req.headers?.['x-netlify-event'] || req.headers?.['x-nf-event'];
  return String(h || '').toLowerCase() === 'schedule';
}

export default async (req) => {
  try {
    if (isScheduled(req)) {
      const result = await syncAllGmailConnections();
      console.log('[sync-gmail-clients]', JSON.stringify({ connections: result.connections }));
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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

    const result = await syncGmailConnection(caller.uid);
    if (!result.ok) {
      return new Response(JSON.stringify({ error: result.error || 'Sync failed.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[sync-gmail-clients]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Gmail sync failed.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

export const config = { schedule: '*/15 * * * *' };

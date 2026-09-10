import { syncAllGmailConnections } from './lib/gmailSync.mjs';

/**
 * Scheduled Gmail → clientEmailMessages sync for all connected mailboxes.
 * Manual Sync now uses sync-gmail-clients-http.mjs (scheduled endpoints can 403 on browser POST).
 */
export default async () => {
  try {
    const result = await syncAllGmailConnections();
    console.log('[sync-gmail-clients]', JSON.stringify({ connections: result.connections }));
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[sync-gmail-clients]', err);
    throw err;
  }
};

export const config = { schedule: '*/15 * * * *' };

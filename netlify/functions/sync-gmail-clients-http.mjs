import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import { syncGmailConnection } from './lib/gmailSync.mjs';

/**
 * Manual "Sync now" for the signed-in admin/billing caller.
 * Kept separate from the scheduled function — Netlify often returns HTTP 403
 * when browsers POST to a function that only has `config.schedule`.
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
    console.error('[sync-gmail-clients-http]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Gmail sync failed.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

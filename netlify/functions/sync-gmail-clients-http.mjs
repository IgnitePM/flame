import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import { syncGmailConnection, syncGmailFullHistoryStep } from './lib/gmailSync.mjs';

/**
 * Manual Gmail sync for the signed-in admin/billing caller.
 * POST body:
 *   { mode?: 'recent' | 'full', restart?: boolean }
 * - recent (default): ~30 day backfill / match pass
 * - full: one chunk of all-time CRM-targeted history (call repeatedly until done)
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

  let body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const mode = String(body?.mode || 'recent').toLowerCase() === 'full' ? 'full' : 'recent';
  const restart = Boolean(body?.restart);

  try {
    const result =
      mode === 'full'
        ? await syncGmailFullHistoryStep(caller.uid, { restart })
        : await syncGmailConnection(caller.uid, { forceBackfill: true });
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

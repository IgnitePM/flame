import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import {
  syncGmailConnection,
  syncGmailFullHistoryStep,
  syncGmailRecentStep,
} from './lib/gmailSync.mjs';

/**
 * Manual Gmail sync for the signed-in admin/billing caller.
 * POST body:
 *   { mode?: 'recent' | 'full' | 'incremental', restart?: boolean }
 * - recent (default): one small CRM-targeted page (call repeatedly until done)
 * - full: one chunk of all-time CRM-targeted history
 * - incremental: single-shot history / catch-up (may be slower)
 *
 * Keep each request small — large Sync-now jobs previously 504'd on Netlify.
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

  const rawMode = String(body?.mode || 'recent').toLowerCase();
  const mode =
    rawMode === 'full'
      ? 'full'
      : rawMode === 'incremental'
        ? 'incremental'
        : 'recent';
  const restart = Boolean(body?.restart);

  try {
    const result =
      mode === 'full'
        ? await syncGmailFullHistoryStep(caller.uid, { restart })
        : mode === 'incremental'
          ? await syncGmailConnection(caller.uid, { forceBackfill: false })
          : await syncGmailRecentStep(caller.uid, { restart });
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

// Give each step enough room; Sync now issues multiple short requests instead of one huge one.
export const config = { maxDuration: 26 };

import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import { runStrategySessionReminders } from './lib/runStrategySessionReminders.mjs';

/**
 * Admin Config "Send now" for Strategy & Review reminders.
 * POST { force?: true, dryRun?: true } with a Firebase ID token.
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

  let force = true;
  let dryRun = false;
  try {
    const body = await req.json();
    if (body?.force === false) force = false;
    if (body?.dryRun === true) dryRun = true;
  } catch {
    // defaults
  }

  try {
    console.log(
      `[send-strategy-session-reminders-manual] force=${force} dryRun=${dryRun} by ${caller.email}`,
    );
    const result = await runStrategySessionReminders({ force, dryRun });
    const errors = Array.isArray(result.errors) ? result.errors : [];
    const safe = {
      ...result,
      errorCount: errors.length,
      errorSummary: errors.slice(0, 8).map((e) => ({
        clientId: e.clientId || null,
        stage: e.stage || null,
        error: e.error || 'unknown',
      })),
    };
    delete safe.errors;

    return new Response(JSON.stringify(safe), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[send-strategy-session-reminders-manual]', err);
    return new Response(
      JSON.stringify({ error: err?.message || String(err) }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
};

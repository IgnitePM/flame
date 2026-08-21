import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import { runAssignmentAlerts, runWorkspaceDigest } from './lib/runDigest.mjs';

/**
 * Manual trigger for the Email Digests admin card ("Send test" buttons).
 * POST { period: 'daily' | 'weekly' | 'assignments' } with a Firebase ID token.
 */
export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // This endpoint sends real email to every configured recipient, so it is
  // restricted to the roles that own digest configuration.
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

  let period = 'daily';
  try {
    const body = await req.json();
    if (body?.period === 'weekly') period = 'weekly';
    if (body?.period === 'assignments') period = 'assignments';
  } catch {
    // No/invalid JSON body — default to 'daily'.
  }

  try {
    console.log(`[send-test-digest] ${period} triggered by ${caller.email}`);
    const result =
      period === 'assignments'
        ? await runAssignmentAlerts()
        : await runWorkspaceDigest(period, { force: true });

    // Counts only. The per-recipient debug objects carry staff email addresses
    // and workload details that don't belong in an HTTP response.
    const safe = { ...result, errorCount: (result.errors || []).length };
    delete safe.details;
    delete safe.emptyDetails;
    delete safe.errors;
    return new Response(JSON.stringify(safe), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const ref = Date.now().toString(36);
    console.error(`[send-test-digest][${ref}] failed:`, err);
    return new Response(JSON.stringify({ error: `Digest run failed (ref ${ref}).` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

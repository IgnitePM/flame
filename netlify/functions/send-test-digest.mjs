import { runAssignmentAlerts, runWorkspaceDigest } from './lib/runDigest.mjs';

/**
 * Manual trigger for the Email Digests admin card ("Send test" buttons).
 * POST { period: 'daily' | 'weekly' | 'assignments' }
 */
export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
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
    const result =
      period === 'assignments'
        ? await runAssignmentAlerts()
        : await runWorkspaceDigest(period);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[send-test-digest] failed:', err);
    return new Response(JSON.stringify({ error: err?.message || String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

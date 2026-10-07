import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import { buildQboAuthUrl, signQboOAuthState } from './lib/quickbooksOAuth.mjs';

/**
 * Admin/billing: start QuickBooks Online OAuth for the company file.
 * POST → { authUrl }
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
    const state = signQboOAuthState({ uid: caller.uid, email: caller.email });
    const authUrl = buildQboAuthUrl(state);
    return new Response(JSON.stringify({ ok: true, authUrl }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[quickbooks-oauth-start]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not start QuickBooks connect.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

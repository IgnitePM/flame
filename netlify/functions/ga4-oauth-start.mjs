import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import { buildGa4AuthUrl, signGa4OAuthState } from './lib/ga4OAuth.mjs';

/**
 * Admin/billing: start Google OAuth for company GA4 (portal SEO traffic).
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
    const state = signGa4OAuthState({ uid: caller.uid, email: caller.email });
    const authUrl = buildGa4AuthUrl(state);
    return new Response(JSON.stringify({ ok: true, authUrl }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[ga4-oauth-start]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not start GA4 connect.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

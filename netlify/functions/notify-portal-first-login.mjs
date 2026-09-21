import { describeAuthError, verifyIdToken, AuthError } from './lib/requireAuth.mjs';
import { recordPortalFirstLogin } from './lib/portalInvite.mjs';

/**
 * Portal client: record first successful sign-in and email admins once.
 * POST {} with Bearer token.
 */
export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const caller = await verifyIdToken(req.headers);
    const result = await recordPortalFirstLogin(caller.email);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    if (err instanceof AuthError) {
      const { status, message } = describeAuthError(err);
      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    console.error('[notify-portal-first-login]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not record portal login.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

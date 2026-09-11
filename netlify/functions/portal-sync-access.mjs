import { describeAuthError, verifyIdToken } from './lib/requireAuth.mjs';
import { syncPortalAccessForEmail } from './lib/portalInvite.mjs';

/**
 * Signed-in portal user self-heal: normalize / restore their email on the
 * invited client's clientEmails so Firestore array-contains login works.
 * POST {} (auth bearer only)
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
    caller = await verifyIdToken(req.headers);
  } catch (err) {
    const { status, message } = describeAuthError(err);
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const result = await syncPortalAccessForEmail(caller.email);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err?.message || String(err);
    console.error('[portal-sync-access]', caller.email, msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

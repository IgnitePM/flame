import {
  AuthError,
  describeAuthError,
  verifyIdToken,
} from './lib/requireAuth.mjs';
import { updatePortalUserProfile } from './lib/portalInvite.mjs';

/**
 * Portal client: update own display name / phone / title on portalInvites.
 * Also best-effort updates Firebase Auth displayName via Identity Toolkit.
 * POST { name, phone?, title? }
 */
export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  try {
    const caller = await verifyIdToken(req.headers);
    const result = await updatePortalUserProfile(caller.email, {
      name: body.name || body.displayName,
      phone: body.phone,
      title: body.title,
    });

    try {
      const apiKey = process.env.VITE_FIREBASE_API_KEY;
      const rawAuth =
        typeof req.headers?.get === 'function'
          ? req.headers.get('authorization')
          : req.headers?.authorization || req.headers?.Authorization;
      const idToken = String(rawAuth || '').replace(/^Bearer\s+/i, '').trim();
      if (apiKey && idToken && result.profile?.name) {
        await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${encodeURIComponent(apiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              idToken,
              displayName: result.profile.name,
              returnSecureToken: false,
            }),
          },
        );
      }
    } catch (err) {
      console.warn('[portal-update-profile] auth name:', err?.message || err);
    }

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
    console.error('[portal-update-profile]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not update profile.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

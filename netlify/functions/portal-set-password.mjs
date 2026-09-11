import {
  completeSetPassword,
  validateSetPasswordToken,
} from './lib/portalInvite.mjs';

/**
 * Public: validate or complete a custom portal set-password token.
 * POST { action: 'validate'|'complete', token, password? }
 * No auth header — token is the credential.
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

  const action = String(body.action || 'validate').toLowerCase();
  const token = String(body.token || '').trim();

  try {
    if (action === 'validate') {
      const result = await validateSetPasswordToken(token);
      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'complete') {
      const result = await completeSetPassword({
        token,
        password: body.password,
      });
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err?.message || String(err);
    console.error('[portal-set-password]', action, msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

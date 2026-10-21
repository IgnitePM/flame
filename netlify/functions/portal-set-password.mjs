import {
  completeSetPassword,
  validateSetPasswordToken,
} from './lib/portalInvite.mjs';
import {
  completeStaffSetPassword,
  validateStaffSetPasswordToken,
} from './lib/staffInvite.mjs';

/**
 * Public: validate or complete a custom set-password token (portal or staff).
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
      const portal = await validateSetPasswordToken(token);
      if (portal.ok) {
        return new Response(JSON.stringify({ ...portal, kind: 'portal' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const staff = await validateStaffSetPasswordToken(token);
      return new Response(JSON.stringify(staff), {
        status: staff.ok ? 200 : 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'complete') {
      const portal = await validateSetPasswordToken(token);
      if (portal.ok) {
        const result = await completeSetPassword({
          token,
          password: body.password,
          profile: {
            name: body.name || body.displayName,
            phone: body.phone,
            title: body.title,
          },
        });
        return new Response(JSON.stringify({ ...result, kind: 'portal' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const result = await completeStaffSetPassword({
        token,
        password: body.password,
        profile: {
          name: body.name || body.displayName,
        },
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

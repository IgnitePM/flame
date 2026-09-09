import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import {
  invitePortalUser,
  markPortalInviteRevoked,
} from './lib/portalInvite.mjs';

/**
 * Admin-only client portal invite / resend / revoke.
 * POST { action: 'invite'|'resend'|'revoke', clientId, email }
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
    caller = await requireStaffCaller(req.headers, { roles: ['admin'] });
  } catch (err) {
    const { status, message } = describeAuthError(err);
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const action = String(body?.action || 'invite').toLowerCase();
  const clientId = String(body?.clientId || '').trim();
  const email = String(body?.email || '').trim().toLowerCase();

  try {
    if (action === 'revoke') {
      if (!email) throw new Error('Missing email.');
      await markPortalInviteRevoked(email);
      return new Response(JSON.stringify({ ok: true, action: 'revoke', email }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'invite' || action === 'resend') {
      const result = await invitePortalUser({
        clientId,
        email,
        invitedBy: caller.email,
        isReminder: action === 'resend',
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
    console.error('[portal-invite]', caller.email, action, msg);
    const clientError =
      /valid email|Missing client|authorized|already authorized|staff account|Could not/i.test(
        msg,
      );
    return new Response(JSON.stringify({ error: msg }), {
      status: clientError ? 400 : 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

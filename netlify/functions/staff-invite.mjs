import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import {
  inviteStaffUser,
  markStaffInviteRevoked,
} from './lib/staffInvite.mjs';

/**
 * Admin-only staff invite / resend / password-reset / revoke.
 * POST { action: 'invite'|'resend'|'reset'|'revoke', email, role?, displayName? }
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
  const email = String(body?.email || '').trim().toLowerCase();
  const role = String(body?.role || 'kiosk').trim().toLowerCase();
  const displayName = String(body?.displayName || '').trim();

  try {
    if (action === 'revoke') {
      if (!email) throw new Error('Missing email.');
      await markStaffInviteRevoked(email);
      return new Response(JSON.stringify({ ok: true, action: 'revoke', email }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'invite' || action === 'resend' || action === 'reset') {
      const result = await inviteStaffUser({
        email,
        role,
        displayName,
        invitedBy: caller.email,
        isReminder: action === 'resend' || action === 'reset',
        forceNewPassword: action === 'reset',
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
    console.error('[staff-invite]', caller.email, action, msg);
    const clientError =
      /valid email|Missing email|portal invite|Could not|Password must/i.test(
        msg,
      );
    return new Response(JSON.stringify({ error: msg }), {
      status: clientError ? 400 : 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

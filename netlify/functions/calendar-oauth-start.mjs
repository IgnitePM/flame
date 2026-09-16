import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import {
  buildCalendarAuthUrl,
  signCalendarOAuthState,
} from './lib/calendarOAuth.mjs';

/**
 * Any staff: start Google OAuth for personal Calendar (kiosk agenda).
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
    caller = await requireStaffCaller(req.headers);
  } catch (err) {
    const { status, message } = describeAuthError(err);
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const state = signCalendarOAuthState({ uid: caller.uid, email: caller.email });
    const authUrl = buildCalendarAuthUrl(state);
    return new Response(JSON.stringify({ ok: true, authUrl }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[calendar-oauth-start]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not start Calendar connect.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

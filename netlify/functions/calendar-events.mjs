import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import {
  getValidAccessToken,
  listUpcomingEvents,
  loadConnection,
} from './lib/calendarOAuth.mjs';

/**
 * Any staff: upcoming events from the caller's primary Google Calendar.
 * POST { days?: number } → { events: [...] }
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

  let body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  try {
    const conn = await loadConnection(caller.uid);
    if (!conn?.refreshToken) {
      return new Response(
        JSON.stringify({ error: 'Google Calendar is not connected.', connected: false }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
    const accessToken = await getValidAccessToken(conn);
    const days = Math.min(30, Math.max(1, Number(body.days) || 7));
    const events = await listUpcomingEvents(accessToken, { days, maxResults: 30 });
    return new Response(
      JSON.stringify({
        ok: true,
        connected: true,
        calendarEmail: conn.calendarEmail || conn.staffEmail || '',
        days,
        events,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[calendar-events]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not load calendar events.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

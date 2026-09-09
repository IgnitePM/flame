import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import { notifyClientSlack } from './lib/clientSlack.mjs';

/**
 * Staff-triggered client Slack post (e.g. estimate sent).
 * POST { clientId, text, alsoGlobal?: boolean }
 */
export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    await requireStaffCaller(req.headers);
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
    const result = await notifyClientSlack({
      clientId: String(body?.clientId || '').trim(),
      text: String(body?.text || '').trim(),
      alsoGlobal: !!body?.alsoGlobal,
    });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[notify-client-slack]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Slack notify failed.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

import {
  describeAuthError,
  requireClientOrStaffCaller,
} from './lib/requireAuth.mjs';
import { fetchCollection, getDigestDb } from './lib/firebaseDigestClient.mjs';

/**
 * Staff directory for @mentions in client Messages (portal + staff).
 * POST { clientId }
 * Returns { emails: string[], people: { email, handle, name }[] }
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

  const clientId = String(body.clientId || '').trim();
  try {
    await requireClientOrStaffCaller(req.headers, clientId);
  } catch (err) {
    const { status, message } = describeAuthError(err);
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const db = await getDigestDb();
    const admins = await fetchCollection(db, 'admins');
    const people = admins
      .map((a) => {
        const email = String(a.email || a.id || '')
          .trim()
          .toLowerCase();
        if (!email || !email.includes('@')) return null;
        const handle = email.split('@')[0] || '';
        const name = String(a.displayName || '').trim() || handle;
        return { email, handle, name };
      })
      .filter(Boolean)
      .sort((a, b) => a.email.localeCompare(b.email));

    return new Response(
      JSON.stringify({
        ok: true,
        emails: people.map((p) => p.email),
        people,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[staff-mention-directory]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not load directory.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

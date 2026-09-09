import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import { sendDigestEmail } from './lib/mailer.mjs';
import { fetchDoc, getDigestDb, mergeDoc } from './lib/firebaseDigestClient.mjs';

/**
 * Admin/billing: send an email to client contacts via Workspace Gmail SMTP.
 * POST { clientId, to: string|string[], subject, body }
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
    caller = await requireStaffCaller(req.headers, { roles: ['admin', 'billing'] });
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

  const clientId = String(body?.clientId || '').trim();
  const subject = String(body?.subject || '').trim();
  const text = String(body?.body || body?.text || '').trim();
  const toRaw = body?.to;
  const toList = [
    ...new Set(
      (Array.isArray(toRaw) ? toRaw : String(toRaw || '').split(/[,\n;]/g))
        .map((e) => String(e || '').trim().toLowerCase())
        .filter((e) => e.includes('@')),
    ),
  ];

  if (!clientId) {
    return new Response(JSON.stringify({ error: 'Missing client.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!toList.length) {
    return new Response(JSON.stringify({ error: 'Add at least one recipient.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!subject || !text) {
    return new Response(JSON.stringify({ error: 'Subject and message are required.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const db = await getDigestDb();
    const client = await fetchDoc(db, `clients/${clientId}`);
    if (!client) {
      return new Response(JSON.stringify({ error: 'Client not found.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const html = `<html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a;line-height:1.5;padding:24px;white-space:pre-wrap;">${text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')}</body></html>`;

    await sendDigestEmail({ to: toList, subject, text, html });

    const logId = `email_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await mergeDoc(db, `auditLogs/${logId}`, {
      type: 'client_email_sent',
      clientId,
      clientName: client.name || '',
      to: toList,
      subject,
      actorEmail: caller.email,
      at: Date.now(),
    });

    await mergeDoc(db, `clients/${clientId}`, {
      lastClientEmailAt: Date.now(),
    });

    return new Response(
      JSON.stringify({ ok: true, to: toList, subject }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[send-client-email]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not send email.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

import {
  AuthError,
  describeAuthError,
  requireClientOrStaffCaller,
} from './lib/requireAuth.mjs';
import {
  createMessageDoc,
  loadClient,
  normalizeAttachments,
  notifyPortalNewMessage,
  notifyStaffClientMessage,
  writeClientActivity,
} from './lib/clientMessaging.mjs';

/**
 * Staff or portal: post a message to the client inbox + email the other party.
 * POST { clientId, body, attachments?, authorName? }
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
  let caller;
  try {
    caller = await requireClientOrStaffCaller(req.headers, clientId);
  } catch (err) {
    const { status, message } = describeAuthError(err);
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const text = String(body.body || body.text || '').trim();
  if (!text) {
    return new Response(JSON.stringify({ error: 'Message body is required.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const client = await loadClient(clientId);
    const attachments = normalizeAttachments(body.attachments);
    const authorName =
      String(body.authorName || '').trim() ||
      (caller.authorType === 'staff' ? caller.email : caller.email);
    const now = Date.now();
    const message = await createMessageDoc({
      clientId,
      body: text,
      authorType: caller.authorType,
      authorEmail: caller.email,
      authorName,
      attachments,
      createdAt: now,
    });

    let emailResult = { sent: 0 };
    try {
      if (caller.authorType === 'staff') {
        emailResult = await notifyPortalNewMessage({
          client,
          messageBody: text,
          authorName,
        });
      } else {
        emailResult = await notifyStaffClientMessage({
          client,
          messageBody: text,
          authorEmail: caller.email,
        });
      }
      if (emailResult.sent > 0) {
        const { mergeDoc, getDigestDb } = await import('./lib/firebaseDigestClient.mjs');
        const db = await getDigestDb();
        await mergeDoc(db, `clientMessages/${message.id}`, {
          emailNotifiedAt: Date.now(),
        });
      }
    } catch (err) {
      console.warn('[client-message-send] email failed:', err?.message || err);
      emailResult = { sent: 0, error: err?.message || String(err) };
    }

    try {
      await writeClientActivity({
        clientId,
        clientName: client.name || '',
        type: 'message_sent',
        title:
          caller.authorType === 'staff'
            ? 'Message sent to client'
            : 'Client sent a portal message',
        body: text.slice(0, 500),
        actorEmail: caller.email,
        source: 'system',
        meta: { messageId: message.id, authorType: caller.authorType },
      });
    } catch (err) {
      console.warn('[client-message-send] activity failed:', err?.message || err);
    }

    return new Response(
      JSON.stringify({ ok: true, message, email: emailResult }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[client-message-send]', err);
    const status = err instanceof AuthError ? err.status : 500;
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not send message.' }),
      { status, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

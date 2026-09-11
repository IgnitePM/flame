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
  notifyStaffMentions,
  writeClientActivity,
} from './lib/clientMessaging.mjs';
import { fetchCollection, getDigestDb, mergeDoc } from './lib/firebaseDigestClient.mjs';
import { parseMentionEmails } from '../../src/utils/taskComments.js';

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

    const db = await getDigestDb();
    let staffEmails = [];
    try {
      const admins = await fetchCollection(db, 'admins');
      staffEmails = admins
        .map((a) => String(a.email || a.id || '').trim().toLowerCase())
        .filter((e) => e.includes('@'));
    } catch (err) {
      console.warn('[client-message-send] staff directory:', err?.message || err);
    }

    const mentionedEmails = parseMentionEmails(text, staffEmails).filter(
      (email) => email !== caller.email,
    );

    const message = await createMessageDoc({
      clientId,
      body: text,
      authorType: caller.authorType,
      authorEmail: caller.email,
      authorName,
      attachments,
      mentionedEmails,
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
        await mergeDoc(db, `clientMessages/${message.id}`, {
          emailNotifiedAt: Date.now(),
        });
      }
    } catch (err) {
      console.warn('[client-message-send] email failed:', err?.message || err);
      emailResult = { sent: 0, error: err?.message || String(err) };
    }

    let mentionEmail = { sent: 0 };
    if (mentionedEmails.length) {
      try {
        for (const email of mentionedEmails) {
          const notifId = `msg_mention_${message.id}_${email.replace(/[^a-z0-9]/gi, '_')}`;
          await mergeDoc(db, `notifications/${notifId}`, {
            recipientEmail: email,
            type: 'mention',
            title: `Mentioned in Messages — ${client.name || 'Client'}`,
            body: `${authorName}: ${text.slice(0, 280)}`,
            createdAt: Date.now(),
            dismissed: false,
            dismissedAt: null,
            actorEmail: caller.email,
            actorName: authorName,
            clientId,
            clientName: client.name || '',
            categoryKey: null,
            itemId: message.id,
            commentId: null,
          });
        }
        mentionEmail = await notifyStaffMentions({
          client,
          messageBody: text,
          authorName,
          mentionedEmails,
        });
      } catch (err) {
        console.warn('[client-message-send] mentions failed:', err?.message || err);
      }
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
      JSON.stringify({
        ok: true,
        message,
        email: emailResult,
        mentions: mentionedEmails,
        mentionEmail,
      }),
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

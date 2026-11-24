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
import {
  buildMentionDirectory,
  parseMentionsFromDirectory,
} from '../../src/utils/taskComments.js';

function portalEmailsFromClient(client) {
  return [
    ...new Set(
      (Array.isArray(client?.clientEmails) ? client.clientEmails : [])
        .map((e) => String(e || '').trim().toLowerCase())
        .filter((e) => e.includes('@')),
    ),
  ];
}

function clientContactsFromClient(client) {
  const rows = [];
  const pc = client?.primaryContact;
  if (pc?.email) {
    rows.push({
      email: String(pc.email || '').trim(),
      name: String(pc.name || '').trim(),
    });
  }
  for (const c of Array.isArray(client?.contacts) ? client.contacts : []) {
    if (!c?.email) continue;
    rows.push({
      email: String(c.email || '').trim(),
      name: String(c.name || '').trim(),
    });
  }
  return rows;
}

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
    let adminUsers = [];
    try {
      const admins = await fetchCollection(db, 'admins');
      adminUsers = admins || [];
      staffEmails = admins
        .filter((a) => a && a.disabled !== true && a.active !== false)
        .map((a) => String(a.email || a.id || '').trim().toLowerCase())
        .filter((e) => e.includes('@'));
    } catch (err) {
      console.warn('[client-message-send] staff directory:', err?.message || err);
    }

    const directory = buildMentionDirectory({
      staffEmails,
      adminUsers,
      clientEmails: portalEmailsFromClient(client),
      clientName: client.name || '',
      clientContacts: clientContactsFromClient(client),
    });
    const parsedMentions = parseMentionsFromDirectory(text, directory);
    const mentionedEmails = (parsedMentions.staffEmails || []).filter(
      (email) => email !== caller.email,
    );
    const mentionedClientEmails = (parsedMentions.clientEmails || []).filter(
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
      mentionedClientEmails,
      createdAt: now,
    });

    let emailResult = { sent: 0 };
    try {
      if (caller.authorType === 'staff') {
        // Portal email recipients:
        // - @tagged client contacts → only those
        // - only @staff tags → skip portal email blast
        // - no tags → email all authorized portal contacts
        let portalRecipients = null;
        if (mentionedClientEmails.length) {
          portalRecipients = mentionedClientEmails;
        } else if (mentionedEmails.length) {
          portalRecipients = [];
        }
        emailResult = await notifyPortalNewMessage({
          client,
          messageBody: text,
          authorName,
          recipientEmails: portalRecipients,
        });
      } else {
        // Client → staff: only notify @tagged staff (no team-wide blast).
        emailResult = await notifyStaffClientMessage({
          client,
          messageBody: text,
          authorEmail: caller.email,
          recipientEmails: mentionedEmails,
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
    // Staff→staff @mentions still get inbox + email even when author is staff
    // (client→staff mentions are covered by notifyStaffClientMessage above).
    if (mentionedEmails.length && caller.authorType === 'staff') {
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
    } else if (mentionedEmails.length && caller.authorType === 'client') {
      // Inbox rows for tagged staff (email already sent via notifyStaffClientMessage).
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
      } catch (err) {
        console.warn('[client-message-send] client mention inbox failed:', err?.message || err);
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
        clientMentions: mentionedClientEmails,
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

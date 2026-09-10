import { writeClientActivity } from './lib/clientActivity.mjs';
import { writeLeadActivity } from './lib/leadActivity.mjs';
import { writeClientEmailMessage } from './lib/clientEmailMessage.mjs';
import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import { fetchDoc, getDigestDb, mergeDoc } from './lib/firebaseDigestClient.mjs';
import {
  buildRawMimeMessage,
  getValidAccessToken,
  gmailGetMessage,
  gmailSendMessage,
  headerValue,
  loadConnection,
} from './lib/gmailOAuth.mjs';

/**
 * Admin/billing: send an email via the caller's connected Gmail.
 * POST { clientId?, leadId?, to, subject, body, inReplyToId? }
 * Exactly one of clientId or leadId.
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
  const leadId = String(body?.leadId || '').trim();
  const subject = String(body?.subject || '').trim();
  const text = String(body?.body || body?.text || '').trim();
  const inReplyToId = body?.inReplyToId ? String(body.inReplyToId).trim() : null;
  const toRaw = body?.to;
  const toList = [
    ...new Set(
      (Array.isArray(toRaw) ? toRaw : String(toRaw || '').split(/[,\n;]/g))
        .map((e) => String(e || '').trim().toLowerCase())
        .filter((e) => e.includes('@')),
    ),
  ];

  if (clientId && leadId) {
    return new Response(JSON.stringify({ error: 'Provide clientId or leadId, not both.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!clientId && !leadId) {
    return new Response(JSON.stringify({ error: 'Missing client or lead.' }), {
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
    const connection = await loadConnection(caller.uid);
    if (!connection?.refreshToken) {
      return new Response(
        JSON.stringify({
          error: 'Connect Gmail in Config before sending client email.',
          code: 'gmail_not_connected',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const db = await getDigestDb();
    let entityName = '';
    if (clientId) {
      const client = await fetchDoc(db, `clients/${clientId}`);
      if (!client) {
        return new Response(JSON.stringify({ error: 'Client not found.' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      entityName = client.name || '';
    } else {
      const lead = await fetchDoc(db, `leads/${leadId}`);
      if (!lead) {
        return new Response(JSON.stringify({ error: 'Lead not found.' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      entityName = lead.companyName || lead.name || '';
    }

    let threadId = null;
    let inReplyToHeader = null;
    let referencesHeader = null;
    if (inReplyToId) {
      const prior = await fetchDoc(db, `clientEmailMessages/${inReplyToId}`);
      if (prior?.gmailThreadId) threadId = prior.gmailThreadId;
      if (prior?.gmailRfc822MessageId) {
        inReplyToHeader = prior.gmailRfc822MessageId;
        referencesHeader = prior.gmailRfc822MessageId;
      } else if (prior?.gmailMessageId) {
        try {
          const accessForLookup = await getValidAccessToken(connection);
          const priorMsg = await gmailGetMessage(accessForLookup, prior.gmailMessageId, 'metadata');
          const mid = headerValue(priorMsg?.payload?.headers || [], 'Message-ID');
          if (mid) {
            inReplyToHeader = mid;
            referencesHeader = mid;
          }
          if (priorMsg?.threadId) threadId = priorMsg.threadId;
        } catch (err) {
          console.warn('[send-client-email] reply headers lookup:', err?.message || err);
        }
      }
    }

    const accessToken = await getValidAccessToken(connection);
    const fromAddr = connection.gmailEmail || caller.email;
    const raw = buildRawMimeMessage({
      from: fromAddr,
      to: toList,
      subject,
      text,
      inReplyTo: inReplyToHeader,
      references: referencesHeader,
    });

    const sent = await gmailSendMessage(accessToken, { raw, threadId });
    let rfc822Id = null;
    try {
      const full = await gmailGetMessage(accessToken, sent.id, 'metadata');
      rfc822Id = headerValue(full?.payload?.headers || [], 'Message-ID') || null;
    } catch {
      /* optional */
    }

    const now = Date.now();
    let emailRecord = null;
    try {
      emailRecord = await writeClientEmailMessage({
        id: sent.id ? `gmail_${sent.id}` : null,
        clientId: clientId || null,
        leadId: leadId || null,
        clientName: clientId ? entityName : '',
        leadName: leadId ? entityName : '',
        to: toList,
        from: fromAddr,
        subject,
        body: text,
        actorEmail: caller.email,
        inReplyToId,
        direction: 'outbound',
        gmailMessageId: sent.id || null,
        gmailThreadId: sent.threadId || threadId || null,
        gmailRfc822MessageId: rfc822Id,
        source: 'ignite_send',
        at: now,
      });
    } catch (err) {
      console.warn('[send-client-email] message store skipped:', err?.message || err);
    }

    const logId = `email_${now}_${Math.random().toString(36).slice(2, 8)}`;
    await mergeDoc(db, `auditLogs/${logId}`, {
      type: leadId ? 'lead_email_sent' : 'client_email_sent',
      clientId: clientId || null,
      leadId: leadId || null,
      clientName: entityName,
      to: toList,
      subject,
      actorEmail: caller.email,
      emailMessageId: emailRecord?.id || null,
      gmailMessageId: sent.id || null,
      at: now,
    });

    try {
      if (leadId) {
        await writeLeadActivity({
          leadId,
          leadName: entityName,
          type: 'email_sent',
          title: subject,
          body: text.slice(0, 800),
          actorEmail: caller.email,
          source: 'system',
          meta: {
            to: toList,
            subject,
            emailMessageId: emailRecord?.id || null,
            gmailMessageId: sent.id || null,
            inReplyToId,
          },
          at: now,
        });
        await mergeDoc(db, `leads/${leadId}`, {
          lastLeadEmailAt: now,
          lastActivityAt: now,
          updatedAt: now,
        });
      } else {
        await writeClientActivity({
          clientId,
          clientName: entityName,
          type: 'email_sent',
          title: subject,
          body: text.slice(0, 800),
          actorEmail: caller.email,
          source: 'system',
          meta: {
            to: toList,
            subject,
            emailMessageId: emailRecord?.id || null,
            gmailMessageId: sent.id || null,
            inReplyToId,
          },
          at: now,
        });
        await mergeDoc(db, `clients/${clientId}`, {
          lastClientEmailAt: now,
        });
      }
    } catch (err) {
      console.warn('[send-client-email] activity log skipped:', err?.message || err);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        to: toList,
        subject,
        emailMessageId: emailRecord?.id || null,
        gmailMessageId: sent.id || null,
      }),
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

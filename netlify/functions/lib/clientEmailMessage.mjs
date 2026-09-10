/**
 * Persist a full CRM email for history (client or lead).
 * Collection: clientEmailMessages/{id}
 * Prefer id `gmail_{gmailMessageId}` when syncing from Gmail for dedupe.
 * Exactly one of clientId or leadId is required.
 */

import { mergeDoc, getDigestDb } from './firebaseDigestClient.mjs';

export async function writeClientEmailMessage({
  id = null,
  clientId = null,
  leadId = null,
  clientName = '',
  leadName = '',
  to = [],
  from = '',
  subject = '',
  body = '',
  actorEmail = '',
  inReplyToId = null,
  direction = 'outbound',
  gmailMessageId = null,
  gmailThreadId = null,
  gmailRfc822MessageId = null,
  source = 'ignite_send',
  at = Date.now(),
} = {}) {
  const cid = String(clientId || '').trim();
  const lid = String(leadId || '').trim();
  if (cid && lid) throw new Error('Provide clientId or leadId, not both.');
  if (!cid && !lid) throw new Error('clientId or leadId required');
  const gmailId = gmailMessageId ? String(gmailMessageId).trim() : null;
  const docId =
    id ||
    (gmailId ? `gmail_${gmailId}` : `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`);
  const doc = {
    clientId: cid || null,
    leadId: lid || null,
    clientName: cid ? String(clientName || '').trim() : '',
    leadName: lid ? String(leadName || clientName || '').trim() : '',
    direction: direction === 'inbound' ? 'inbound' : 'outbound',
    to: Array.isArray(to) ? to : [String(to || '')].filter(Boolean),
    from: String(from || '').trim(),
    subject: String(subject || '').trim(),
    body: String(body || ''),
    actorEmail: String(actorEmail || '').trim().toLowerCase(),
    inReplyToId: inReplyToId || null,
    gmailMessageId: gmailId,
    gmailThreadId: gmailThreadId || null,
    gmailRfc822MessageId: gmailRfc822MessageId || null,
    source: String(source || 'ignite_send'),
    sentAt: Number(at) || Date.now(),
    createdAt: Number(at) || Date.now(),
  };
  const db = await getDigestDb();
  await mergeDoc(db, `clientEmailMessages/${docId}`, doc);
  return { id: docId, ...doc };
}

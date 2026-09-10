/**
 * Persist a full client email for CRM history.
 * Collection: clientEmailMessages/{id}
 * Prefer id `gmail_{gmailMessageId}` when syncing from Gmail for dedupe.
 */

import { mergeDoc, getDigestDb } from './firebaseDigestClient.mjs';

export async function writeClientEmailMessage({
  id = null,
  clientId,
  clientName = '',
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
  if (!cid) throw new Error('clientId required');
  const gmailId = gmailMessageId ? String(gmailMessageId).trim() : null;
  const docId =
    id ||
    (gmailId ? `gmail_${gmailId}` : `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`);
  const doc = {
    clientId: cid,
    clientName: String(clientName || '').trim(),
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

/**
 * Persist a full outbound client email for CRM history.
 * Collection: clientEmailMessages/{id}
 */

import { mergeDoc, getDigestDb } from './firebaseDigestClient.mjs';

export async function writeClientEmailMessage({
  clientId,
  clientName = '',
  to = [],
  subject = '',
  body = '',
  actorEmail = '',
  inReplyToId = null,
  at = Date.now(),
} = {}) {
  const cid = String(clientId || '').trim();
  if (!cid) throw new Error('clientId required');
  const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const doc = {
    clientId: cid,
    clientName: String(clientName || '').trim(),
    direction: 'outbound',
    to: Array.isArray(to) ? to : [String(to || '')].filter(Boolean),
    subject: String(subject || '').trim(),
    body: String(body || ''),
    actorEmail: String(actorEmail || '').trim().toLowerCase(),
    inReplyToId: inReplyToId || null,
    sentAt: Number(at) || Date.now(),
    createdAt: Number(at) || Date.now(),
  };
  const db = await getDigestDb();
  await mergeDoc(db, `clientEmailMessages/${id}`, doc);
  return { id, ...doc };
}

/**
 * Write a leadActivities doc from Netlify functions (digest-bot session).
 */

import { mergeDoc, getDigestDb } from './firebaseDigestClient.mjs';

function activityTypeLabel(type) {
  const labels = {
    note: 'Note',
    call: 'Call',
    meeting: 'Meeting',
    email_sent: 'Email sent',
    email_received: 'Email received',
    tag: 'Tag',
  };
  return labels[type] || String(type || 'Activity');
}

export function buildLeadActivityDoc({
  leadId,
  leadName = '',
  type,
  title,
  body = '',
  actorEmail = '',
  source = 'system',
  meta = {},
  at = Date.now(),
} = {}) {
  const lid = String(leadId || '').trim();
  if (!lid) throw new Error('leadId is required for lead activity.');
  const t = String(type || '').trim();
  if (!t) throw new Error('type is required for lead activity.');
  return {
    leadId: lid,
    leadName: String(leadName || '').trim(),
    type: t,
    title: String(title || activityTypeLabel(t)).trim() || activityTypeLabel(t),
    body: String(body || '').trim(),
    actorEmail: String(actorEmail || '').trim().toLowerCase() || 'system',
    source: source === 'manual' ? 'manual' : 'system',
    meta: meta && typeof meta === 'object' ? meta : {},
    at: Number(at) || Date.now(),
  };
}

export async function writeLeadActivity(fields) {
  const doc = buildLeadActivityDoc(fields);
  const id = `act_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const db = await getDigestDb();
  await mergeDoc(db, `leadActivities/${id}`, doc);
  return { id, ...doc };
}

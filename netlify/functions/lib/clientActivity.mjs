/**
 * Write a clientActivities doc from Netlify functions (digest-bot session).
 */

import { mergeDoc, getDigestDb } from './firebaseDigestClient.mjs';

function activityTypeLabel(type) {
  const labels = {
    note: 'Note',
    call: 'Call',
    meeting: 'Meeting',
    email_sent: 'Email sent',
    email_received: 'Email received',
    portal_invite: 'Portal invite',
    estimate_sent: 'Estimate sent',
    estimate_decision: 'Estimate decision',
    project_request: 'Project request',
    client_note_saved: 'Internal note',
    file_upload: 'File',
    task_completed: 'Task completed',
    tag: 'Tag',
    message_sent: 'Message',
    review_sent: 'Approval sent',
    review_decision: 'Approval decision',
    todo_request: 'Task request',
    todo_request_decision: 'Task request decision',
  };
  return labels[type] || String(type || 'Activity');
}

export function buildClientActivityDoc({
  clientId,
  clientName = '',
  type,
  title,
  body = '',
  actorEmail = '',
  source = 'system',
  meta = {},
  at = Date.now(),
} = {}) {
  const cid = String(clientId || '').trim();
  if (!cid) throw new Error('clientId is required for client activity.');
  const t = String(type || '').trim();
  if (!t) throw new Error('type is required for client activity.');
  return {
    clientId: cid,
    clientName: String(clientName || '').trim(),
    type: t,
    title: String(title || activityTypeLabel(t)).trim() || activityTypeLabel(t),
    body: String(body || '').trim(),
    actorEmail: String(actorEmail || '').trim().toLowerCase() || 'system',
    source: source === 'manual' ? 'manual' : 'system',
    meta: meta && typeof meta === 'object' ? meta : {},
    at: Number(at) || Date.now(),
  };
}

export async function writeClientActivity(fields) {
  const doc = buildClientActivityDoc(fields);
  const id = `act_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const db = await getDigestDb();
  await mergeDoc(db, `clientActivities/${id}`, doc);
  return { id, ...doc };
}

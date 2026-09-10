/** Client CRM activity timeline helpers. */

export const CLIENT_ACTIVITY_TYPES = {
  note: { label: 'Note', group: 'notes' },
  call: { label: 'Call', group: 'notes' },
  meeting: { label: 'Meeting', group: 'notes' },
  email_sent: { label: 'Email', group: 'email' },
  email_received: { label: 'Email received', group: 'email' },
  portal_invite: { label: 'Portal invite', group: 'portal' },
  estimate_sent: { label: 'Estimate sent', group: 'projects' },
  estimate_decision: { label: 'Estimate decision', group: 'projects' },
  project_request: { label: 'Project request', group: 'projects' },
  client_note_saved: { label: 'Internal note', group: 'notes' },
  file_upload: { label: 'File', group: 'files' },
};

export const MANUAL_ACTIVITY_TYPES = ['note', 'call', 'meeting'];

export const ACTIVITY_FILTER_GROUPS = [
  { id: 'all', label: 'All' },
  { id: 'notes', label: 'Notes' },
  { id: 'email', label: 'Email' },
  { id: 'portal', label: 'Portal' },
  { id: 'projects', label: 'Projects' },
  { id: 'files', label: 'Files' },
];

export function activityTypeLabel(type) {
  return CLIENT_ACTIVITY_TYPES[type]?.label || String(type || 'Activity');
}

export function activityMatchesFilter(activity, filterId) {
  if (!filterId || filterId === 'all') return true;
  const group = CLIENT_ACTIVITY_TYPES[activity?.type]?.group;
  return group === filterId;
}

/**
 * Build a plain activity document (no id). Safe to spread into addDoc/setDoc.
 */
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

export function formatActivityWhen(at) {
  const ms = Number(at || 0);
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

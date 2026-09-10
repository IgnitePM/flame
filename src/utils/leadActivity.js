/** Lead CRM activity timeline helpers (mirrors clientActivity). */

import {
  ACTIVITY_FILTER_GROUPS,
  CLIENT_ACTIVITY_TYPES,
  MANUAL_ACTIVITY_TYPES,
  activityIsCollapsible,
  activityMatchesFilter,
  activityTypeLabel,
  formatActivityWhen,
} from './clientActivity.js';

export {
  ACTIVITY_FILTER_GROUPS,
  CLIENT_ACTIVITY_TYPES as LEAD_ACTIVITY_TYPES,
  MANUAL_ACTIVITY_TYPES,
  activityIsCollapsible,
  activityMatchesFilter,
  activityTypeLabel,
  formatActivityWhen,
};

/**
 * Build a plain leadActivities document (no id).
 */
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

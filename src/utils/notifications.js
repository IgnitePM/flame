import { normalizeStaffEmail } from './staffDirectory.js';
import { getTaskComments } from './taskComments.js';

export const NOTIFICATION_TYPES = {
  TASK_ASSIGNED: 'task_assigned',
  MENTION: 'mention',
  FORGOT_CLOCK_OUT: 'forgot_clock_out',
  AI_INSIGHT: 'ai_insight',
};

export function notificationTypeLabel(type) {
  if (type === NOTIFICATION_TYPES.TASK_ASSIGNED) return 'Assigned to you';
  if (type === NOTIFICATION_TYPES.MENTION) return 'Mentioned you';
  if (type === NOTIFICATION_TYPES.FORGOT_CLOCK_OUT) return 'Clock-out';
  if (type === NOTIFICATION_TYPES.AI_INSIGHT) return 'AI brief';
  return 'Update';
}

export function buildNotificationDoc({
  recipientEmail,
  type,
  title,
  body = '',
  actorEmail = '',
  actorName = '',
  clientId = null,
  clientName = null,
  categoryKey = null,
  itemId = null,
  commentId = null,
}) {
  const recipient = normalizeStaffEmail(recipientEmail);
  if (!recipient || !type || !title) return null;
  return {
    recipientEmail: recipient,
    type,
    title: String(title).slice(0, 200),
    body: String(body || '').slice(0, 500),
    createdAt: Date.now(),
    dismissed: false,
    dismissedAt: null,
    actorEmail: normalizeStaffEmail(actorEmail),
    actorName: String(actorName || '').slice(0, 80),
    clientId: clientId || null,
    clientName: clientName || null,
    categoryKey: categoryKey || null,
    itemId: itemId || null,
    commentId: commentId || null,
  };
}

function itemMap(items = []) {
  const map = new Map();
  for (const item of items || []) {
    if (item?.id) map.set(item.id, item);
  }
  return map;
}

function assigneesOf(item) {
  return Array.isArray(item?.assigneeEmails)
    ? item.assigneeEmails.map((e) => normalizeStaffEmail(e)).filter(Boolean)
    : [];
}

/**
 * Diff previous vs next category items and produce notification docs
 * for new assignees and new @mentions.
 */
export function collectTodoChangeNotifications({
  prevItems = [],
  nextItems = [],
  actorEmail,
  actorName,
  clientId,
  clientName,
  categoryKey,
}) {
  const actor = normalizeStaffEmail(actorEmail);
  const prev = itemMap(prevItems);
  const docs = [];

  for (const nextItem of nextItems || []) {
    if (!nextItem?.id) continue;
    const before = prev.get(nextItem.id);
    const nextAssignees = assigneesOf(nextItem);
    const prevAssignees = new Set(assigneesOf(before));
    const added = nextAssignees.filter((email) => !prevAssignees.has(email) && email !== actor);
    for (const email of added) {
      const doc = buildNotificationDoc({
        recipientEmail: email,
        type: NOTIFICATION_TYPES.TASK_ASSIGNED,
        title: nextItem.text || 'New task assigned to you',
        body: clientName
          ? `${actorName || actor || 'A teammate'} assigned you on ${clientName}`
          : `${actorName || actor || 'A teammate'} assigned you a task`,
        actorEmail: actor,
        actorName,
        clientId,
        clientName,
        categoryKey,
        itemId: nextItem.id,
      });
      if (doc) docs.push(doc);
    }

    const prevCommentIds = new Set(getTaskComments(before).map((c) => c.id));
    for (const comment of getTaskComments(nextItem)) {
      if (!comment?.id || prevCommentIds.has(comment.id)) continue;
      for (const email of comment.mentions || []) {
        if (normalizeStaffEmail(email) === actor) continue;
        const doc = buildNotificationDoc({
          recipientEmail: email,
          type: NOTIFICATION_TYPES.MENTION,
          title: nextItem.text || 'You were mentioned',
          body: `${comment.authorName || comment.authorEmail}: ${comment.text}`,
          actorEmail: comment.authorEmail,
          actorName: comment.authorName,
          clientId,
          clientName,
          categoryKey,
          itemId: nextItem.id,
          commentId: comment.id,
        });
        if (doc) docs.push(doc);
      }
    }
  }

  return docs;
}

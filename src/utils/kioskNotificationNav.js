import { NOTIFICATION_TYPES } from './notifications.js';
import { getRetainerCategoryNameFromKey } from './retainerCategories.js';

/**
 * Decide how the kiosk should open a notification.
 * Pure — no React / Firestore.
 */

export function isMessagesMentionNotification(n) {
  if (!n) return false;
  const title = String(n.title || '');
  if (/mentioned in messages/i.test(title)) return true;
  // Message mentions store the clientMessages doc id on itemId and have no category.
  return (
    n.type === NOTIFICATION_TYPES.MENTION &&
    !!n.itemId &&
    !n.categoryKey
  );
}

export function findClientForNotification(clients = [], n) {
  if (!n) return null;
  const byId = n.clientId
    ? clients.find((c) => c?.id === n.clientId)
    : null;
  if (byId) return byId;
  const name = String(n.clientName || '').trim().toLowerCase();
  if (!name) return null;
  return (
    clients.find((c) => String(c?.name || '').trim().toLowerCase() === name) ||
    null
  );
}

export function resolveBillingTargetForCategoryKey(
  client,
  categoryKey,
  todoCategoryKeyFn,
  projects = [],
) {
  if (!categoryKey || !todoCategoryKeyFn) return null;
  const retainerName = getRetainerCategoryNameFromKey(
    client,
    categoryKey,
    todoCategoryKeyFn,
  );
  if (retainerName) return `retainer_${retainerName}`;

  for (const p of projects || []) {
    if (!p?.id) continue;
    if (todoCategoryKeyFn(`project_${p.id}`) === categoryKey) {
      return `project_${p.id}`;
    }
  }

  // Fall back: if categoryKey looks like a project key already.
  if (String(categoryKey).startsWith('project_')) {
    return String(categoryKey);
  }
  return null;
}

/**
 * Locate a todo item across billing cycles (approvals / notes may not store cycleStart).
 */
export function findTodoLocationInClient(client, { itemId, categoryKey } = {}) {
  if (!client || !itemId) return null;
  const cycles =
    client.todoCycles && typeof client.todoCycles === 'object'
      ? client.todoCycles
      : {};
  const preferKey = categoryKey ? String(categoryKey) : null;

  const scanCategory = (cycleStart, catKey, cat) => {
    const items = Array.isArray(cat?.items) ? cat.items : [];
    const item = items.find((it) => it?.id === itemId);
    if (!item) return null;
    return {
      cycleStart: Number(cycleStart) || cycleStart,
      categoryKey: catKey,
      item,
    };
  };

  if (preferKey) {
    for (const [cycleStart, cycleData] of Object.entries(cycles)) {
      if (!cycleData || typeof cycleData !== 'object') continue;
      const hit = scanCategory(cycleStart, preferKey, cycleData[preferKey]);
      if (hit) return hit;
    }
  }

  for (const [cycleStart, cycleData] of Object.entries(cycles)) {
    if (!cycleData || typeof cycleData !== 'object') continue;
    for (const [catKey, cat] of Object.entries(cycleData)) {
      if (preferKey && catKey === preferKey) continue;
      const hit = scanCategory(cycleStart, catKey, cat);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * @returns {{
 *   kind: 'messages'|'todo'|'client'|'client_admin'|'personal'|null,
 *   clientId: string|null,
 *   clientName: string|null,
 *   billingTarget: string|null,
 *   categoryKey: string|null,
 *   itemId: string|null,
 *   messageId: string|null,
 *   commentId: string|null,
 * }}
 */
export function resolveKioskNotificationTarget(
  n,
  { clients = [], projects = [], todoCategoryKeyFn = null } = {},
) {
  const empty = {
    kind: null,
    clientId: null,
    clientName: null,
    billingTarget: null,
    categoryKey: null,
    itemId: null,
    messageId: null,
    commentId: null,
  };
  if (!n) return empty;

  const client = findClientForNotification(clients, n);
  const clientId = client?.id || n.clientId || null;
  const clientName = client?.name || n.clientName || null;

  if (isMessagesMentionNotification(n)) {
    return {
      ...empty,
      kind: 'messages',
      clientId,
      clientName,
      messageId: n.itemId || null,
      itemId: n.itemId || null,
    };
  }

  if (n.type === NOTIFICATION_TYPES.PORTAL_FEEDBACK) {
    return {
      ...empty,
      kind: 'client_admin',
      clientId,
      clientName,
      itemId: n.itemId || null,
    };
  }

  if (n.type === NOTIFICATION_TYPES.FORGOT_CLOCK_OUT) {
    return { ...empty, kind: 'personal' };
  }

  const todoTypes = new Set([
    NOTIFICATION_TYPES.TODO_APPROVAL,
    NOTIFICATION_TYPES.TASK_ASSIGNED,
    NOTIFICATION_TYPES.PORTAL_TODO_NOTE,
    NOTIFICATION_TYPES.MENTION,
  ]);

  if (todoTypes.has(n.type) || n.itemId || n.categoryKey) {
    const location = client
      ? findTodoLocationInClient(client, {
          itemId: n.itemId,
          categoryKey: n.categoryKey,
        })
      : null;
    const categoryKey = location?.categoryKey || n.categoryKey || null;
    const billingTarget = client
      ? resolveBillingTargetForCategoryKey(
          client,
          categoryKey,
          todoCategoryKeyFn,
          projects,
        )
      : null;

    return {
      ...empty,
      kind: clientName || clientId ? 'todo' : null,
      clientId,
      clientName,
      billingTarget,
      categoryKey,
      itemId: n.itemId || location?.item?.id || null,
      commentId: n.commentId || null,
    };
  }

  if (clientName || clientId) {
    return {
      ...empty,
      kind: 'client',
      clientId,
      clientName,
    };
  }

  return empty;
}

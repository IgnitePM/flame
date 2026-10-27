/**
 * Outbound task approval (client or staff review before done).
 * Separate from inbound portal `requestStatus` (client requesting a new task).
 */

import { getRetainerCategoryNameFromKey } from './retainerCategories.js';

export const TODO_APPROVAL = {
  PENDING_CLIENT: 'pending_client',
  PENDING_STAFF: 'pending_staff',
  REVISION_REQUESTED: 'revision_requested',
};

export function getTodoApprovalStatus(item) {
  return String(item?.approvalStatus || '').trim() || null;
}

export function isTodoPendingApproval(item) {
  const s = getTodoApprovalStatus(item);
  return s === TODO_APPROVAL.PENDING_CLIENT || s === TODO_APPROVAL.PENDING_STAFF;
}

export function isTodoAwaitingClientApproval(item) {
  return getTodoApprovalStatus(item) === TODO_APPROVAL.PENDING_CLIENT;
}

export function isTodoAwaitingStaffApproval(item) {
  return getTodoApprovalStatus(item) === TODO_APPROVAL.PENDING_STAFF;
}

export function todoApprovalBadgeLabel(item) {
  const s = getTodoApprovalStatus(item);
  if (s === TODO_APPROVAL.PENDING_CLIENT) return 'Awaiting client';
  if (s === TODO_APPROVAL.PENDING_STAFF) return 'Awaiting staff review';
  if (s === TODO_APPROVAL.REVISION_REQUESTED) return 'Revisions requested';
  return null;
}

export function clearTodoApprovalFields(item = {}) {
  return {
    ...item,
    approvalStatus: null,
    approvalTarget: null,
    approvalReviewerEmails: [],
    approvalNote: '',
    approvalDecisionNote: '',
    approvalRequestedByEmail: null,
    approvalRequestedAt: null,
    approvalDecisionByEmail: null,
    approvalDecisionAt: null,
    reviewDeadline: null,
    approvalAutoApprove: false,
    approvalAutoApprovedAt: null,
  };
}

export function applyTodoApprovalSend(item, {
  target,
  reviewerEmails = [],
  note = '',
  byEmail = '',
  now = Date.now(),
  reviewDeadline = null,
  approvalAutoApprove = false,
}) {
  const t = target === 'staff' ? 'staff' : 'client';
  const reviewers = (Array.isArray(reviewerEmails) ? reviewerEmails : [])
    .map((e) => String(e || '').trim().toLowerCase())
    .filter((e) => e.includes('@'));
  if (t === 'staff' && !reviewers.length) {
    throw new Error('Pick at least one staff reviewer.');
  }
  const deadlineMs = Number(reviewDeadline) || 0;
  const autoApprove = t === 'client' && Boolean(approvalAutoApprove) && deadlineMs > 0;
  return {
    ...item,
    done: false,
    doneAt: null,
    approvalStatus:
      t === 'staff' ? TODO_APPROVAL.PENDING_STAFF : TODO_APPROVAL.PENDING_CLIENT,
    approvalTarget: t,
    approvalReviewerEmails: t === 'staff' ? reviewers : [],
    approvalNote: String(note || '').trim(),
    approvalDecisionNote: '',
    approvalRequestedByEmail: String(byEmail || '').trim().toLowerCase() || null,
    approvalRequestedAt: now,
    approvalDecisionByEmail: null,
    approvalDecisionAt: null,
    reviewDeadline: autoApprove || (t === 'client' && deadlineMs > 0) ? deadlineMs : null,
    approvalAutoApprove: autoApprove,
    approvalAutoApprovedAt: null,
  };
}

export function applyTodoApprovalDecision(item, {
  decision,
  note = '',
  byEmail = '',
  now = Date.now(),
  autoApproved = false,
}) {
  const d = String(decision || '').trim();
  if (d === 'approved') {
    return {
      ...clearTodoApprovalFields(item),
      done: true,
      doneAt: now,
      approvalDecisionNote: String(note || '').trim(),
      approvalDecisionByEmail: String(byEmail || '').trim().toLowerCase() || null,
      approvalDecisionAt: now,
      approvalAutoApprovedAt: autoApproved ? now : null,
    };
  }
  if (d === 'revisions_requested') {
    return {
      ...clearTodoApprovalFields(item),
      done: false,
      doneAt: null,
      approvalStatus: TODO_APPROVAL.REVISION_REQUESTED,
      approvalDecisionNote: String(note || '').trim(),
      approvalDecisionByEmail: String(byEmail || '').trim().toLowerCase() || null,
      approvalDecisionAt: now,
    };
  }
  throw new Error('decision must be approved or revisions_requested.');
}

/** Open for active work (not done, not waiting on approval). */
export function isTodoOpenForWork(item) {
  if (item?.done) return false;
  if (item?.requestStatus === 'rejected') return false;
  if (isTodoPendingApproval(item)) return false;
  return true;
}

/** Client review past deadline and flagged for auto-approve. */
export function isTodoReadyForAutoApprove(item, now = Date.now()) {
  if (!isTodoAwaitingClientApproval(item)) return false;
  if (!item?.approvalAutoApprove) return false;
  const deadline = Number(item?.reviewDeadline || 0);
  return deadline > 0 && now >= deadline;
}

/** Pending, revisions, or a recorded decision — anything for the Approvals history. */
export function isTodoApprovalTracked(item) {
  if (!item) return false;
  if (isTodoPendingApproval(item)) return true;
  if (getTodoApprovalStatus(item) === TODO_APPROVAL.REVISION_REQUESTED) return true;
  if (Number(item.approvalDecisionAt || 0) > 0) return true;
  if (Number(item.approvalRequestedAt || 0) > 0 && getTodoApprovalStatus(item)) {
    return true;
  }
  return false;
}

export function todoApprovalActivityAt(item) {
  return Math.max(
    Number(item?.approvalDecisionAt || 0),
    Number(item?.approvalRequestedAt || 0),
    0,
  );
}

/**
 * Collect retainer task approval rows across every stored billing cycle
 * (plus the live current-cycle view). Used on the agency client Approvals tab.
 */
export function collectClientTaskApprovalRows(
  client,
  {
    getBillingPeriod,
    getTodoStateForCycle,
    todoCategoryKey,
    projects = [],
  } = {},
) {
  if (!client) return [];

  const billingDay = client.billingDay || 1;
  const currentCycleStart = getBillingPeriod
    ? getBillingPeriod(billingDay, 0).start
    : Date.now();
  const cycles = client.todoCycles || {};
  const cycleStartSet = new Set(
    Object.keys(cycles)
      .map((k) => Number(k))
      .filter((n) => Number.isFinite(n)),
  );
  cycleStartSet.add(Number(currentCycleStart));

  const labelFor = (catKey) => {
    const resolved = getRetainerCategoryNameFromKey(
      client,
      catKey,
      todoCategoryKey,
    );
    if (resolved) return resolved;
    const projectId =
      typeof catKey === 'string' && catKey.startsWith('project_')
        ? catKey.slice('project_'.length)
        : '';
    if (projectId) {
      const hit = (projects || []).find((p) => p?.id === projectId);
      if (hit?.title) return hit.title;
    }
    if (String(catKey || '').includes('General')) {
      return 'General / Unclassified (legacy)';
    }
    return catKey;
  };

  const rows = [];
  for (const cycleStart of cycleStartSet) {
    const todoState =
      Number(cycleStart) === Number(currentCycleStart) && getTodoStateForCycle
        ? getTodoStateForCycle(client, cycleStart) || {}
        : cycles[String(cycleStart)] || {};
    for (const [categoryKey, catTodo] of Object.entries(todoState)) {
      for (const item of catTodo?.items || []) {
        if (!isTodoApprovalTracked(item)) continue;
        rows.push({
          clientId: client.id,
          cycleStart: Number(cycleStart),
          categoryKey,
          categoryLabel: labelFor(categoryKey),
          item,
          pending: isTodoPendingApproval(item),
          activityAt: todoApprovalActivityAt(item),
        });
      }
    }
  }

  // Same task id can exist on multiple cycles after carry-forward — keep the
  // copy with the newest approval activity (then newest cycle).
  const byKey = new Map();
  for (const row of rows) {
    const itemId = row?.item?.id;
    if (!itemId) continue;
    const key = `${row.categoryKey}__${itemId}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, row);
      continue;
    }
    if (row.activityAt > prev.activityAt) {
      byKey.set(key, row);
      continue;
    }
    if (
      row.activityAt === prev.activityAt &&
      Number(row.cycleStart) > Number(prev.cycleStart)
    ) {
      byKey.set(key, row);
    }
  }

  return [...byKey.values()].sort((a, b) => {
    if (a.pending !== b.pending) return a.pending ? -1 : 1;
    return Number(b.activityAt || 0) - Number(a.activityAt || 0);
  });
}

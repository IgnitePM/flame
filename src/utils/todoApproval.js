/**
 * Outbound task approval (client or staff review before done).
 * Separate from inbound portal `requestStatus` (client requesting a new task).
 */

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
  };
}

export function applyTodoApprovalSend(item, {
  target,
  reviewerEmails = [],
  note = '',
  byEmail = '',
  now = Date.now(),
}) {
  const t = target === 'staff' ? 'staff' : 'client';
  const reviewers = (Array.isArray(reviewerEmails) ? reviewerEmails : [])
    .map((e) => String(e || '').trim().toLowerCase())
    .filter((e) => e.includes('@'));
  if (t === 'staff' && !reviewers.length) {
    throw new Error('Pick at least one staff reviewer.');
  }
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
  };
}

export function applyTodoApprovalDecision(item, {
  decision,
  note = '',
  byEmail = '',
  now = Date.now(),
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

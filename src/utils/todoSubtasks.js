import { normalizeEmail, normalizeEmailList } from './teamClientAccess.js';

export function getSubtasks(item) {
  return Array.isArray(item?.subtasks) ? item.subtasks : [];
}

export function hasSubtasks(item) {
  return getSubtasks(item).length > 0;
}

export function openSubtaskCount(item) {
  return getSubtasks(item).filter((s) => !s?.done).length;
}

/** Parent row can only be marked complete when every sub-task is done (or there are none). */
export function canMarkParentTodoDone(item) {
  return !hasSubtasks(item) || openSubtaskCount(item) === 0;
}

export function parentDueCapMs(item) {
  const d = Number(item?.dueDate || 0);
  return Number.isFinite(d) && d > 0 ? d : null;
}

export function clampSubtaskDueToParent(parentItem, subDueMs) {
  if (subDueMs == null || subDueMs === '') return null;
  const n = Number(subDueMs);
  if (!Number.isFinite(n)) return null;
  const cap = parentDueCapMs(parentItem);
  if (cap == null) return n;
  return Math.min(n, cap);
}

/**
 * When spawning a new recurring primary row, map each sub-task due to the new cycle
 * while preserving offset from the old parent due and capping to the new parent due.
 */
export function projectSubtaskDueDateForNewCycle(oldParentDue, newParentDue, oldSubDue) {
  const np = Number(newParentDue || 0);
  if (!np) return null;
  const os = Number(oldSubDue || 0);
  if (!os) return null;
  const op = Number(oldParentDue || 0);
  if (op) {
    const shifted = np + (os - op);
    return Math.min(shifted, np);
  }
  return Math.min(os, np);
}

export function effectiveParentAssigneesForItem(parentItem, fallbackUserEmail) {
  const p = normalizeEmailList(parentItem?.assigneeEmails);
  if (p.length) return p;
  const fb = normalizeEmail(fallbackUserEmail);
  return fb ? [fb] : [];
}

export function effectiveSubtaskAssignees(sub, parentItem, fallbackUserEmail) {
  const subList = normalizeEmailList(sub?.assigneeEmails);
  if (subList.length) return subList;
  return effectiveParentAssigneesForItem(parentItem, fallbackUserEmail);
}

/** Union of assignees used for "mine" filters (parent + each sub-task's effective list). */
export function collectEffectiveAssigneesForTodoTree(item, fallbackUserEmail) {
  const set = new Set(effectiveParentAssigneesForItem(item, fallbackUserEmail));
  for (const s of getSubtasks(item)) {
    for (const e of effectiveSubtaskAssignees(s, item, fallbackUserEmail)) {
      set.add(e);
    }
  }
  return [...set];
}

export function newSubtaskId() {
  return `sub_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function newSubtaskTemplate(overrides = {}) {
  return {
    id: newSubtaskId(),
    text: '',
    done: false,
    doneAt: null,
    assigneeEmails: [],
    dueDate: null,
    ...overrides,
  };
}

export function mapItemSubtasks(item, mapper) {
  return { ...item, subtasks: getSubtasks(item).map(mapper) };
}

export function updateSubtaskInItems(items, parentId, subId, patch) {
  return items.map((i) => {
    if (i.id !== parentId) return i;
    return mapItemSubtasks(i, (s) => (s.id === subId ? { ...s, ...patch } : s));
  });
}

export function setSubtaskDoneInItems(items, parentId, subId, done) {
  return updateSubtaskInItems(items, parentId, subId, {
    done: !!done,
    doneAt: done ? Date.now() : null,
  });
}

export function addSubtaskToItems(items, parentId, subtask) {
  return items.map((i) => {
    if (i.id !== parentId) return i;
    const next = [...getSubtasks(i), subtask];
    return { ...i, subtasks: next };
  });
}

export function removeSubtaskFromItems(items, parentId, subId) {
  return items.map((i) => {
    if (i.id !== parentId) return i;
    return { ...i, subtasks: getSubtasks(i).filter((s) => s.id !== subId) };
  });
}

/** When parent due date moves earlier, clamp every sub-task due date. */
export function clampAllSubtaskDueDatesToParent(parentItem) {
  const cap = parentDueCapMs(parentItem);
  if (cap == null) return parentItem;
  return mapItemSubtasks(parentItem, (s) => {
    const d = Number(s?.dueDate || 0);
    if (!d || d <= cap) return s;
    return { ...s, dueDate: cap };
  });
}

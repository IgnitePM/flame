import { orderTodosForDisplay, reorderTodosDisplay } from './todoListOrder.js';
import {
  getSubtasks,
  hasSubtasks,
  removeSubtaskFromItems,
} from './todoSubtasks.js';

export function encodeTodoDragPayload(payload) {
  return JSON.stringify(payload);
}

/** @returns {{ kind: 'primary', id: string } | { kind: 'subtask', id: string, parentId: string } | null} */
export function decodeTodoDragPayload(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.kind === 'primary' && parsed.id) {
      return { kind: 'primary', id: String(parsed.id) };
    }
    if (parsed?.kind === 'subtask' && parsed.id && parsed.parentId) {
      return {
        kind: 'subtask',
        id: String(parsed.id),
        parentId: String(parsed.parentId),
      };
    }
  } catch {
    // Legacy plain primary id from older drag handlers.
  }
  if (typeof raw === 'string' && raw.trim() && !raw.trim().startsWith('{')) {
    return { kind: 'primary', id: raw.trim() };
  }
  return null;
}

function findPrimary(items, id) {
  return (items || []).find((i) => i?.id === id) || null;
}

function primaryFromSubtask(sub) {
  return {
    id: sub.id,
    text: sub.text || '',
    done: !!sub.done,
    doneAt: sub.doneAt ?? null,
    dueDate: sub.dueDate ?? null,
    assigneeEmails: Array.isArray(sub.assigneeEmails)
      ? sub.assigneeEmails.filter(Boolean)
      : [],
    pinned: false,
    recurring: false,
    subtasks: [],
  };
}

function subtaskFromPrimary(primary) {
  return {
    id: primary.id,
    text: primary.text || '',
    done: !!primary.done,
    doneAt: primary.doneAt ?? null,
    dueDate: primary.dueDate ?? null,
    assigneeEmails: Array.isArray(primary.assigneeEmails)
      ? primary.assigneeEmails.filter(Boolean)
      : [],
  };
}

function insertPrimaryBefore(items, primary, beforePrimaryId) {
  const display = orderTodosForDisplay(items || []);
  const toIdx = beforePrimaryId
    ? display.findIndex((i) => i.id === beforePrimaryId)
    : display.length;
  const next = [...display];
  next.splice(toIdx < 0 ? next.length : toIdx, 0, primary);
  return next;
}

function reorderSubtasksInParent(parentItem, fromSubId, beforeSubId) {
  const subs = [...getSubtasks(parentItem)];
  const fromIdx = subs.findIndex((s) => s.id === fromSubId);
  if (fromIdx < 0) return parentItem;
  const rawToIdx = beforeSubId
    ? subs.findIndex((s) => s.id === beforeSubId)
    : subs.length;
  if (rawToIdx < 0) return parentItem;
  const [moved] = subs.splice(fromIdx, 1);
  let insertAt = rawToIdx;
  if (fromIdx < rawToIdx) insertAt -= 1;
  subs.splice(Math.max(0, insertAt), 0, moved);
  return { ...parentItem, subtasks: subs };
}

function insertSubtaskInParent(parentItem, sub, beforeSubId) {
  const subs = [...getSubtasks(parentItem)];
  const idx = beforeSubId ? subs.findIndex((s) => s.id === beforeSubId) : subs.length;
  subs.splice(idx < 0 ? subs.length : idx, 0, sub);
  return { ...parentItem, subtasks: subs };
}

function appendSubtaskToPrimary(items, parentId, sub) {
  return items.map((i) =>
    i.id === parentId ? insertSubtaskInParent(i, sub, null) : i,
  );
}

/**
 * Apply drag-and-drop for client todo lists.
 *
 * drop targets:
 * - `{ type: 'before-primary', primaryId }` — reorder before a primary row
 * - `{ type: 'nest-under-primary', primaryId }` — nest dragged primary as last step
 * - `{ type: 'before-subtask', parentId, subtaskId }`
 */
export function applyTodoListDragDrop(items, drag, drop) {
  const list = items || [];
  if (!drag || !drop) return { ok: false, items: list };

  if (drag.kind === 'primary' && drop.type === 'before-primary') {
    if (drag.id === drop.primaryId) return { ok: false, items: list };
    const display = orderTodosForDisplay(list);
    const fromIdx = display.findIndex((i) => i.id === drag.id);
    const toIdx = display.findIndex((i) => i.id === drop.primaryId);
    if (fromIdx < 0 || toIdx < 0) return { ok: false, items: list };
    return { ok: true, items: reorderTodosDisplay(list, fromIdx, toIdx) };
  }

  if (drag.kind === 'primary' && drop.type === 'nest-under-primary') {
    const primary = findPrimary(list, drag.id);
    if (!primary) return { ok: false, items: list };
    if (primary.id === drop.primaryId) {
      return { ok: false, items: list, error: 'Cannot nest a task under itself.' };
    }
    if (hasSubtasks(primary)) {
      return {
        ok: false,
        items: list,
        error: 'Move or delete sub-tasks before nesting this task under another.',
      };
    }
    const sub = subtaskFromPrimary(primary);
    let next = list.filter((i) => i.id !== drag.id);
    next = appendSubtaskToPrimary(next, drop.primaryId, sub);
    return { ok: true, items: next };
  }

  if (drag.kind === 'subtask' && drop.type === 'before-subtask') {
    const { parentId: toParentId, subtaskId: beforeSubId } = drop;
    const found = findPrimary(list, drag.parentId);
    const sub = getSubtasks(found).find((s) => s.id === drag.id);
    if (!found || !sub) return { ok: false, items: list };

    if (drag.parentId === toParentId) {
      const next = list.map((i) =>
        i.id === toParentId
          ? reorderSubtasksInParent(i, drag.id, beforeSubId)
          : i,
      );
      return { ok: true, items: next };
    }

    let next = removeSubtaskFromItems(list, drag.parentId, drag.id);
    next = next.map((i) =>
      i.id === toParentId ? insertSubtaskInParent(i, sub, beforeSubId) : i,
    );
    return { ok: true, items: next };
  }

  if (drag.kind === 'subtask' && drop.type === 'before-primary') {
    const found = findPrimary(list, drag.parentId);
    const sub = getSubtasks(found).find((s) => s.id === drag.id);
    if (!found || !sub) return { ok: false, items: list };
    let next = removeSubtaskFromItems(list, drag.parentId, drag.id);
    const primary = primaryFromSubtask(sub);
    next = insertPrimaryBefore(next, primary, drop.primaryId);
    return { ok: true, items: next };
  }

  if (drag.kind === 'primary' && drop.type === 'before-subtask') {
    const primary = findPrimary(list, drag.id);
    if (!primary) return { ok: false, items: list };
    if (primary.id === drop.parentId) {
      return { ok: false, items: list, error: 'Cannot nest a task under itself.' };
    }
    if (hasSubtasks(primary)) {
      return {
        ok: false,
        items: list,
        error: 'Move or delete sub-tasks before nesting this task under another.',
      };
    }
    const sub = subtaskFromPrimary(primary);
    let next = list.filter((i) => i.id !== drag.id);
    next = next.map((i) =>
      i.id === drop.parentId
        ? insertSubtaskInParent(i, sub, drop.subtaskId)
        : i,
    );
    return { ok: true, items: next };
  }

  return { ok: false, items: list };
}

export function readTodoDragPayload(dataTransfer) {
  if (!dataTransfer) return null;
  const encoded = dataTransfer.getData('application/x-ignite-todo');
  if (encoded) return decodeTodoDragPayload(encoded);
  return decodeTodoDragPayload(dataTransfer.getData('text/plain'));
}

export function writeTodoDragPayload(dataTransfer, payload) {
  if (!dataTransfer || !payload) return;
  const encoded = encodeTodoDragPayload(payload);
  dataTransfer.setData('application/x-ignite-todo', encoded);
  dataTransfer.setData('text/plain', encoded);
  dataTransfer.effectAllowed = 'move';
}

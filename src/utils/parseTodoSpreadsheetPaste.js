import { normalizeEmail } from './teamClientAccess.js';
import {
  clampSubtaskDueToParent,
  newSubtaskTemplate,
} from './todoSubtasks.js';

/** @typedef {'parent' | 'subtask'} PasteRowRole */

/**
 * @typedef {object} PastePreviewRow
 * @property {string} previewId
 * @property {string} text
 * @property {string|null} assigneeEmail
 * @property {number|null} dueDateMs
 * @property {string} dueDisplay
 * @property {number|null} estimatedHours
 * @property {PasteRowRole} role
 */

/**
 * @param {string} raw
 * @returns {number|null} local noon ms, or null
 */
export function parsePasteDueToMs(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    if (!y || !m || !d) return null;
    const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
    return Number.isNaN(dt.getTime()) ? null : dt.getTime();
  }

  const slash = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(s);
  if (slash) {
    let a = Number(slash[1]);
    let b = Number(slash[2]);
    let y = Number(slash[3]);
    if (y < 100) y += 2000;
    // Prefer M/D/Y (US locale); if first > 12, treat as D/M/Y
    let month;
    let day;
    if (a > 12) {
      day = a;
      month = b;
    } else {
      month = a;
      day = b;
    }
    if (!month || !day || month > 12 || day > 31) return null;
    const dt = new Date(y, month - 1, day, 12, 0, 0, 0);
    return Number.isNaN(dt.getTime()) ? null : dt.getTime();
  }

  const parsed = Date.parse(s);
  if (!Number.isFinite(parsed)) return null;
  const dt = new Date(parsed);
  if (Number.isNaN(dt.getTime())) return null;
  return new Date(
    dt.getFullYear(),
    dt.getMonth(),
    dt.getDate(),
    12,
    0,
    0,
    0,
  ).getTime();
}

export function formatDueDisplay(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return '';
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function looksLikeHeaderCell(cell) {
  const t = String(cell || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  return t === 'task' || t === 'title' || t === 'todo' || t === 'todos';
}

/**
 * Split a pasted line into cells. Prefer TSV when tabs are present.
 * @param {string} line
 * @returns {string[]}
 */
export function splitPasteLine(line) {
  const raw = String(line ?? '');
  if (raw.includes('\t')) {
    return raw.split('\t');
  }
  // Simple CSV: split on commas not inside double quotes
  const cells = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') {
      if (inQuotes && raw[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      cells.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  return cells;
}

/**
 * Detect nesting from leading tab / 2+ spaces on the task cell.
 * @param {string} taskCell
 * @returns {{ depth: number, text: string }}
 */
export function readTaskCellNesting(taskCell) {
  const raw = String(taskCell ?? '');
  let i = 0;
  let depthUnits = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '\t') {
      depthUnits += 1;
      i++;
      continue;
    }
    if (ch === ' ') {
      let spaces = 0;
      while (i < raw.length && raw[i] === ' ') {
        spaces++;
        i++;
      }
      depthUnits += Math.floor(spaces / 2);
      continue;
    }
    break;
  }
  return {
    depth: depthUnits > 0 ? 1 : 0, // v1: only one nesting level
    text: raw.slice(i).trim(),
  };
}

/**
 * @param {string} raw
 * @returns {number|null}
 */
export function parsePasteEstimatedHours(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/,/g, '')
    .replace(/h(ours?)?$/, '')
    .trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 4) / 4; // quarter-hour steps
}

/**
 * Split a pasted line and resolve task / assignee / due / estimate with nesting.
 * Leading empty TSV cells (from a leading Tab) count as nesting depth.
 *
 * @param {string} line
 * @returns {{ depth: number, text: string, assignee: string, due: string, estimate: string }}
 */
export function parsePasteLineFields(line) {
  const cells = splitPasteLine(line);
  let leadEmpty = 0;
  while (
    leadEmpty < cells.length &&
    String(cells[leadEmpty] ?? '').trim() === ''
  ) {
    leadEmpty++;
  }
  if (leadEmpty > 0 && leadEmpty < cells.length) {
    const nested = readTaskCellNesting(cells[leadEmpty] ?? '');
    const rest = cells.slice(leadEmpty + 1);
    return {
      depth: Math.min(1, leadEmpty + nested.depth) > 0 ? 1 : 0,
      text: nested.text,
      assignee: rest[0] ?? '',
      due: rest[1] ?? '',
      estimate: rest[2] ?? '',
    };
  }
  const nested = readTaskCellNesting(cells[0] ?? '');
  return {
    depth: nested.depth > 0 ? 1 : 0,
    text: nested.text,
    assignee: cells[1] ?? '',
    due: cells[2] ?? '',
    estimate: cells[3] ?? '',
  };
}

function resolveAssigneeEmail(raw, assignableEmails, defaultAssigneeEmail) {
  const normalized = normalizeEmail(raw);
  const fallback = normalizeEmail(defaultAssigneeEmail);
  const allow =
    Array.isArray(assignableEmails) && assignableEmails.length > 0
      ? new Set(assignableEmails.map(normalizeEmail).filter(Boolean))
      : null;

  if (normalized) {
    if (allow && !allow.has(normalized)) {
      // Invalid assignee — fall back to default if allowed, else empty
      if (fallback && (!allow || allow.has(fallback))) return fallback;
      return null;
    }
    return normalized;
  }
  if (fallback && (!allow || allow.has(fallback))) return fallback;
  return fallback || null;
}

function newPreviewId(counter) {
  return `paste_${Date.now()}_${counter}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Parse Excel/Sheets TSV (or simple CSV) into preview rows.
 *
 * @param {string} text
 * @param {object} [options]
 * @param {string[]} [options.assignableEmails]
 * @param {string} [options.defaultAssigneeEmail]
 * @param {Iterable<string>} [options.existingParentTexts] — exact-match dedupe (case-insensitive)
 * @returns {PastePreviewRow[]}
 */
export function parseTodoSpreadsheetPaste(text, options = {}) {
  const {
    assignableEmails,
    defaultAssigneeEmail,
    existingParentTexts,
  } = options;

  const existing = new Set(
    [...(existingParentTexts || [])]
      .map((t) => String(t || '').trim().toLowerCase())
      .filter(Boolean),
  );

  const lines = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');

  /** @type {PastePreviewRow[]} */
  const rows = [];
  let counter = 0;
  let sawData = false;
  let lastWasParent = false;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (!String(line || '').trim()) continue;

    const { depth, text, assignee: assigneeRaw, due: dueRaw, estimate: estimateRaw } =
      parsePasteLineFields(line);

    if (!sawData && looksLikeHeaderCell(text || '')) {
      // Skip header row
      continue;
    }

    if (!text) continue;
    sawData = true;

    const dueDateMs = parsePasteDueToMs(dueRaw);
    const estimatedHours = parsePasteEstimatedHours(estimateRaw);
    const assigneeEmail = resolveAssigneeEmail(
      assigneeRaw,
      assignableEmails,
      defaultAssigneeEmail,
    );

    const wantsSub = depth > 0;
    // Subtasks only attach under a previous parent; otherwise promote to parent
    const role = wantsSub && lastWasParent ? 'subtask' : 'parent';

    if (role === 'parent') {
      const key = text.toLowerCase();
      if (existing.has(key)) {
        // Skip duplicate; clear parent so following indents don't attach to a prior task
        lastWasParent = false;
        continue;
      }
      existing.add(key);
      lastWasParent = true;
    }

    rows.push({
      previewId: newPreviewId(++counter),
      text,
      assigneeEmail,
      dueDateMs,
      dueDisplay: formatDueDisplay(dueDateMs),
      estimatedHours,
      role,
    });
  }

  return rows;
}

/**
 * Remove a preview row. Removing a parent also removes following subtasks.
 * @param {PastePreviewRow[]} rows
 * @param {string} previewId
 * @returns {PastePreviewRow[]}
 */
export function removePastePreviewRow(rows, previewId) {
  const list = Array.isArray(rows) ? rows : [];
  const idx = list.findIndex((r) => r.previewId === previewId);
  if (idx < 0) return list;
  if (list[idx].role === 'parent') {
    let end = idx + 1;
    while (end < list.length && list[end].role === 'subtask') end++;
    return [...list.slice(0, idx), ...list.slice(end)];
  }
  return list.filter((r) => r.previewId !== previewId);
}

/**
 * Convert preview rows into parent todo items with nested subtasks.
 *
 * @param {PastePreviewRow[]} rows
 * @param {object} [options]
 * @param {() => string} [options.newParentId]
 * @returns {object[]}
 */
export function buildTodoItemsFromPasteRows(rows, options = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const newParentId =
    options.newParentId ||
    (() => {
      let n = 0;
      return () =>
        `todo_${Date.now()}_${++n}_${Math.random().toString(36).slice(2, 9)}`;
    })();

  const items = [];
  /** @type {object|null} */
  let current = null;

  for (const row of list) {
    if (!row || !String(row.text || '').trim()) continue;
    if (row.role === 'subtask' && current) {
      const due = clampSubtaskDueToParent(current, row.dueDateMs);
      const sub = newSubtaskTemplate({
        text: String(row.text).trim(),
        dueDate: due,
        assigneeEmails: row.assigneeEmail ? [row.assigneeEmail] : [],
        estimatedHours: row.estimatedHours != null ? Number(row.estimatedHours) : null,
      });
      current.subtasks = [...(current.subtasks || []), sub];
      continue;
    }

    current = {
      id: newParentId(),
      text: String(row.text).trim(),
      done: false,
      doneAt: null,
      pinned: false,
      recurring: false,
      recurringId: null,
      dueDate: row.dueDateMs != null ? Number(row.dueDateMs) : null,
      assigneeEmails: row.assigneeEmail ? [row.assigneeEmail] : [],
      estimatedHours: row.estimatedHours != null ? Number(row.estimatedHours) : null,
      subtasks: [],
    };
    items.push(current);
  }

  return items;
}

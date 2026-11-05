/**
 * Pure helpers for MCP write tools (no Firebase imports).
 */

import { getEnabledRetainerCategoryNames } from '../../../src/utils/retainerCategories.js';
import { MAX_NOTE_CHARS } from './mcpSanitize.mjs';

export const MAX_TODO_TEXT = 4_000;
export const MAX_ASSIGNEES = 10;
export const DEFAULT_MCP_ACTOR = 'perplexity-mcp@ignitepm.com';

export function todoCategoryKey(name) {
  return String(name ?? '')
    .replace(/[~*[\]/]/g, '_')
    .replace(/\./g, '_');
}

export function resolveMcpActorEmail(override) {
  const fromArg = String(override || '')
    .trim()
    .toLowerCase();
  if (fromArg.includes('@')) return fromArg;
  const fromEnv = String(process.env.PERPLEXITY_MCP_ACTOR_EMAIL || '')
    .trim()
    .toLowerCase();
  if (fromEnv.includes('@')) return fromEnv;
  return DEFAULT_MCP_ACTOR;
}

export function normalizeAssigneeEmails(raw) {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return [
    ...new Set(
      list
        .map((e) => String(e || '').trim().toLowerCase())
        .filter((e) => e.includes('@')),
    ),
  ].slice(0, MAX_ASSIGNEES);
}

export function parseDueDateMs(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  const s = String(raw).trim();
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

export function resolveRetainerCategory(client, { category, categoryKey } = {}) {
  const enabled = getEnabledRetainerCategoryNames(client);
  if (!enabled.length) {
    const err = new Error('No enabled retainer categories on this client.');
    err.code = 'no_categories';
    throw err;
  }
  const label = String(category || '').trim();
  const key = String(categoryKey || '').trim();
  const matched =
    enabled.find((cat) => cat === label) ||
    enabled.find((cat) => todoCategoryKey(cat) === key) ||
    enabled.find((cat) => todoCategoryKey(cat) === todoCategoryKey(label)) ||
    enabled.find(
      (cat) => label && String(cat).toLowerCase() === label.toLowerCase(),
    );
  if (!matched) {
    const err = new Error(
      `Unknown category. Enabled: ${enabled.join(', ')}. Pass category or categoryKey.`,
    );
    err.code = 'bad_category';
    throw err;
  }
  return { categoryLabel: matched, categoryKey: todoCategoryKey(matched) };
}

export function mergeNoteText(existing, incoming, mode = 'append') {
  const next = String(incoming || '').trim();
  if (!next) {
    const err = new Error('Note text is required.');
    err.code = 'bad_request';
    throw err;
  }
  if (next.length > MAX_NOTE_CHARS) {
    const err = new Error(`Note text exceeds ${MAX_NOTE_CHARS} characters.`);
    err.code = 'too_long';
    throw err;
  }
  const prev = String(existing || '').trim();
  if (mode === 'replace' || !prev) return next;
  return `${prev}\n\n${next}`;
}

export function buildStaffTodoItem({
  text,
  assigneeEmails = [],
  dueDate = null,
  estimatedHours = null,
  pinned = false,
  now = Date.now(),
} = {}) {
  const body = String(text || '').trim();
  if (!body) {
    const err = new Error('Task text is required.');
    err.code = 'bad_request';
    throw err;
  }
  if (body.length > MAX_TODO_TEXT) {
    const err = new Error(`Task text exceeds ${MAX_TODO_TEXT} characters.`);
    err.code = 'too_long';
    throw err;
  }
  let hours = null;
  if (estimatedHours != null && estimatedHours !== '') {
    const n = Number(estimatedHours);
    if (!Number.isFinite(n) || n < 0 || n > 500) {
      const err = new Error('estimatedHours must be a number between 0 and 500.');
      err.code = 'bad_request';
      throw err;
    }
    hours = n;
  }
  return {
    id: `todo_${now}_${Math.random().toString(36).slice(2)}`,
    text: body,
    done: false,
    doneAt: null,
    pinned: !!pinned,
    recurring: false,
    recurringId: null,
    dueDate: parseDueDateMs(dueDate),
    assigneeEmails: normalizeAssigneeEmails(assigneeEmails),
    recurrence: null,
    estimatedHours: hours,
    subtasks: [],
  };
}

/**
 * Pure helpers for MCP write tools (no Firebase imports).
 */

import {
  getEnabledRetainerCategoryNames,
  isRetainerCategoryDollar,
} from '../../../src/utils/retainerCategories.js';
import {
  clampSubtaskDueToParent,
  newSubtaskTemplate,
} from '../../../src/utils/todoSubtasks.js';
import { FALLBACK_FX_TO_CAD, getFxToCad } from '../../../src/utils/fxToCad.js';
import {
  buildPerplexityExpenseDescription,
  computePerplexityExpenseAmounts,
} from '../../../src/utils/perplexityCredits.js';
import { MAX_NOTE_CHARS } from './mcpSanitize.mjs';

export const MAX_TODO_TEXT = 4_000;
export const MAX_ASSIGNEES = 10;
export const DEFAULT_MCP_ACTOR = 'perplexity-mcp@ignitepm.com';
export const MAX_LOGGED_HOURS = 12;
export const EXPENSE_MARKUP = 1.3;

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

export function buildStaffSubtask(parentItem, args = {}, now = Date.now()) {
  const text = String(args.text || '').trim();
  if (!text) {
    const err = new Error('Subtask text is required.');
    err.code = 'bad_request';
    throw err;
  }
  if (text.length > MAX_TODO_TEXT) {
    const err = new Error(`Subtask text exceeds ${MAX_TODO_TEXT} characters.`);
    err.code = 'too_long';
    throw err;
  }
  let estimatedHours = null;
  if (args.estimatedHours != null && args.estimatedHours !== '') {
    const n = Number(args.estimatedHours);
    if (!Number.isFinite(n) || n < 0 || n > 500) {
      const err = new Error('estimatedHours must be a number between 0 and 500.');
      err.code = 'bad_request';
      throw err;
    }
    estimatedHours = n;
  }
  const dueRaw = parseDueDateMs(args.dueDate);
  return newSubtaskTemplate({
    id: `sub_${now}_${Math.random().toString(36).slice(2, 9)}`,
    text,
    assigneeEmails: normalizeAssigneeEmails(args.assigneeEmails),
    dueDate: clampSubtaskDueToParent(parentItem, dueRaw),
    estimatedHours,
  });
}

/** Parse hours / minutes / start+end into duration ms (max 12h). */
export function resolveDurationMs(args = {}) {
  const start = parseDueDateMs(args.startTime || args.date);
  const end = parseDueDateMs(args.endTime);
  if (start && end && end > start) {
    const ms = end - start;
    if (ms > MAX_LOGGED_HOURS * 3600000) {
      const err = new Error(`Duration cannot exceed ${MAX_LOGGED_HOURS} hours.`);
      err.code = 'too_long';
      throw err;
    }
    return { startMs: start, endMs: end, durationMs: ms };
  }

  const hours = Number(args.hours || 0);
  const minutes = Number(args.minutes || args.durationMinutes || 0);
  const durationMs = Math.round(
    (Number.isFinite(hours) ? hours : 0) * 3600000 +
      (Number.isFinite(minutes) ? minutes : 0) * 60000,
  );
  if (!(durationMs > 0)) {
    const err = new Error(
      'Provide hours/minutes (or durationMinutes), or startTime+endTime.',
    );
    err.code = 'bad_request';
    throw err;
  }
  if (durationMs > MAX_LOGGED_HOURS * 3600000) {
    const err = new Error(`Duration cannot exceed ${MAX_LOGGED_HOURS} hours.`);
    err.code = 'too_long';
    throw err;
  }
  const startMs = start || Date.now() - durationMs;
  return { startMs, endMs: startMs + durationMs, durationMs };
}

export function computeExpenseAmounts({
  amount,
  currency = 'CAD',
  credits = null,
  applyMarkup = true,
  hourlyRate = 0,
  categoryLabel,
  client,
  fxToCad = null,
} = {}) {
  const isDollar = isRetainerCategoryDollar(client, categoryLabel);
  const fx = getFxToCad(fxToCad || FALLBACK_FX_TO_CAD);

  if (credits != null && credits !== '') {
    const n = Number(credits);
    if (!Number.isFinite(n) || n <= 0) {
      const err = new Error('credits must be a positive number.');
      err.code = 'bad_request';
      throw err;
    }
    const computed = computePerplexityExpenseAmounts(n, {
      applyMarkup,
      hourlyRate,
      isDollar,
      usdToCad: fx.USD,
    });
    return {
      isPerplexity: true,
      isDollar,
      rawAmount: computed.rawAmount,
      finalCost: computed.finalCost,
      equivalentHours: computed.equivalentHours,
      originalCurrency: 'PERPLEXITY_CREDITS',
      originalAmount: n,
      perplexityCredits: n,
      fxRateToCad: computed.usdToCad,
      descriptionDefault: buildPerplexityExpenseDescription(n, ''),
    };
  }

  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) {
    const err = new Error('amount must be a positive number.');
    err.code = 'bad_request';
    throw err;
  }
  const code = String(currency || 'CAD').trim().toUpperCase() || 'CAD';
  const rateToCad = fx[code] ?? 1;
  const amountCad = n * rateToCad;
  const shouldMarkup = applyMarkup !== false && !isDollar;
  const finalCost = shouldMarkup ? amountCad * EXPENSE_MARKUP : amountCad;
  const rate = Number(hourlyRate || 0);
  const equivalentHours = isDollar || rate <= 0 ? 0 : finalCost / rate;
  return {
    isPerplexity: false,
    isDollar,
    rawAmount: amountCad,
    finalCost,
    equivalentHours,
    originalCurrency: code,
    originalAmount: n,
    perplexityCredits: null,
    fxRateToCad: code === 'CAD' ? null : rateToCad,
    descriptionDefault: '',
  };
}

/** Locate a todo item inside client.todoCycles. */
export function findTodoInClient(client, todoId, hints = {}) {
  const id = String(todoId || '').trim();
  if (!id) return null;
  const cycles = client?.todoCycles || {};
  const preferCycle =
    hints.cycleStart != null && hints.cycleStart !== ''
      ? String(hints.cycleStart)
      : null;
  const preferCat = String(hints.categoryKey || '').trim() || null;

  const searchOrder = preferCycle
    ? [preferCycle, ...Object.keys(cycles).filter((k) => k !== preferCycle)]
    : Object.keys(cycles);

  for (const cycleKey of searchOrder) {
    const cycleData = cycles[cycleKey] || {};
    const catKeys = preferCat
      ? [preferCat, ...Object.keys(cycleData).filter((k) => k !== preferCat)]
      : Object.keys(cycleData);
    for (const categoryKey of catKeys) {
      const cat = cycleData[categoryKey];
      const item = (cat?.items || []).find((i) => i?.id === id);
      if (item) {
        return {
          cycleStart: Number(cycleKey) || cycleKey,
          cycleKey: String(cycleKey),
          categoryKey,
          item,
          catTodo: cat,
        };
      }
    }
  }
  return null;
}

export function extractDriveFileId(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^[a-zA-Z0-9_-]{10,}$/.test(s) && !s.includes('/')) return s;
  const m =
    s.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
    s.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
    s.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : '';
}

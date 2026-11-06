/**
 * Shared recurrence helpers for Admin / Kiosk / MCP.
 * Modes match the CRM Options UI: none | daily | weekly | biweekly | monthly | annual.
 */

export const RECURRENCE_MODES = [
  'none',
  'daily',
  'weekly',
  'biweekly',
  'monthly',
  'annual',
];

export function normalizeRecurrenceMode(raw) {
  const m = String(raw || 'none')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!m || m === 'none' || m === 'off' || m === 'false') return 'none';
  if (m === 'day' || m === 'daily' || m === 'daily_fixed') return 'daily';
  if (m === 'week' || m === 'weekly' || m === 'weekly_weekday') return 'weekly';
  if (
    m === 'biweek' ||
    m === 'biweekly' ||
    m === 'bi_weekly' ||
    m === 'fortnightly' ||
    m === 'biweekly_weekday'
  ) {
    return 'biweekly';
  }
  if (m === 'month' || m === 'monthly' || m === 'monthly_fixed_day') {
    return 'monthly';
  }
  if (
    m === 'year' ||
    m === 'yearly' ||
    m === 'annual' ||
    m === 'annually' ||
    m === 'annual_fixed'
  ) {
    return 'annual';
  }
  return '';
}

/**
 * Map UI recurrence mode + anchor due date into stored `recurrence` object.
 * Returns null for none / unknown.
 */
export function buildRecurrenceFromMode(mode, dueDateMs) {
  const m = normalizeRecurrenceMode(mode);
  if (!m || m === 'none') return null;
  const hasMs = dueDateMs != null && !Number.isNaN(Number(dueDateMs));
  const src = hasMs ? new Date(Number(dueDateMs)) : new Date();
  if (Number.isNaN(src.getTime())) return null;
  src.setHours(12, 0, 0, 0);
  if (m === 'weekly') {
    return { type: 'weekly_weekday', weekday: src.getDay() };
  }
  if (m === 'biweekly') {
    return {
      type: 'biweekly_weekday',
      weekday: src.getDay(),
      anchorMs: src.getTime(),
    };
  }
  if (m === 'daily') {
    return { type: 'daily_fixed' };
  }
  if (m === 'monthly') {
    return { type: 'monthly_fixed_day', dayOfMonth: src.getDate() };
  }
  if (m === 'annual') {
    return {
      type: 'annual_fixed',
      month: src.getMonth(),
      day: src.getDate(),
    };
  }
  return null;
}

/** Accept a raw recurrence object from callers; validate known types. */
export function normalizeRecurrenceObject(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = String(raw.type || '').trim();
  const known = new Set([
    'daily_fixed',
    'weekly_weekday',
    'biweekly_weekday',
    'monthly_fixed_day',
    'annual_fixed',
  ]);
  if (!known.has(type)) return null;
  return { ...raw, type };
}

/**
 * Resolve recurrence from either `recurrenceMode` or a raw `recurrence` object.
 * @returns {{ recurrence: object|null, mode: string }}
 */
export function resolveRecurrenceInput({
  recurrenceMode,
  recurrence,
  dueDateMs,
} = {}) {
  const fromObj = normalizeRecurrenceObject(recurrence);
  if (fromObj) {
    return {
      recurrence: fromObj,
      mode: recurrenceModeFromStored(fromObj) || 'custom',
    };
  }
  const mode = normalizeRecurrenceMode(recurrenceMode);
  if (!mode) {
    const err = new Error(
      `Unknown recurrenceMode. Use one of: ${RECURRENCE_MODES.join(', ')}.`,
    );
    err.code = 'bad_request';
    throw err;
  }
  if (mode === 'none') return { recurrence: null, mode: 'none' };
  const built = buildRecurrenceFromMode(mode, dueDateMs);
  return { recurrence: built, mode };
}

export function recurrenceModeFromStored(recurrence) {
  const t = String(recurrence?.type || '');
  if (t === 'daily_fixed') return 'daily';
  if (t === 'weekly_weekday') return 'weekly';
  if (t === 'biweekly_weekday') return 'biweekly';
  if (t === 'monthly_fixed_day') return 'monthly';
  if (t === 'annual_fixed') return 'annual';
  return '';
}

/** Apply recurrence fields onto a todo / subtask item. */
export function applyRecurrenceFields(item, recurrence, { seriesId } = {}) {
  const next = { ...(item || {}) };
  if (!recurrence) {
    next.recurring = false;
    next.recurringId = null;
    next.recurrence = null;
    return next;
  }
  const rid = String(seriesId || next.recurringId || next.id || '').trim();
  next.recurring = true;
  next.recurringId = rid || next.id;
  next.recurrence = recurrence;
  return next;
}

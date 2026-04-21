import { getSubtasks, newSubtaskId, projectSubtaskDueDateForNewCycle } from './todoSubtasks.js';

function stableRecurringSeriesId(item) {
  if (!item?.recurring) return '';
  return String(item.recurringId || item.id || '');
}

function sameCalendarDay(a, b) {
  const na = Number(a || 0);
  const nb = Number(b || 0);
  if (!na || !nb) return false;
  return new Date(na).toDateString() === new Date(nb).toDateString();
}

function effectiveRecurrence(item) {
  if (item?.recurrence?.type) return item.recurrence;
  const d = Number(item?.dueDate || 0);
  if (!d) return null;
  return {
    type: 'monthly_fixed_day',
    dayOfMonth: new Date(d).getDate(),
  };
}

/**
 * All recurrence anchor timestamps inside [windowStartMs, windowEndMs] (inclusive).
 */
export function listRecurringAnchorsInWindow(recurrence, windowStartMs, windowEndMs) {
  if (!recurrence?.type) return [];
  const ws = Number(windowStartMs);
  const we = Number(windowEndMs);
  if (!Number.isFinite(ws) || !Number.isFinite(we) || we < ws) return [];

  if (recurrence.type === 'daily_fixed') {
    const out = [];
    const d = new Date(ws);
    d.setHours(12, 0, 0, 0);
    for (let guard = 0; guard < 800 && d.getTime() <= we; guard++) {
      out.push(d.getTime());
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  if (recurrence.type === 'weekly_weekday') {
    const wd = Number(recurrence.weekday);
    if (!Number.isFinite(wd) || wd < 0 || wd > 6) return [];
    const out = [];
    const d = new Date(ws);
    d.setHours(12, 0, 0, 0);
    for (let guard = 0; guard < 400 && d.getTime() <= we; guard++) {
      if (d.getDay() === wd) out.push(d.getTime());
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  if (recurrence.type === 'biweekly_weekday') {
    const wd = Number(recurrence.weekday);
    if (!Number.isFinite(wd) || wd < 0 || wd > 6) return [];
    const anchor = Number(recurrence.anchorMs || 0);
    const out = [];
    const d = new Date(ws);
    d.setHours(12, 0, 0, 0);
    for (let guard = 0; guard < 800 && d.getTime() <= we; guard++) {
      if (d.getDay() === wd) {
        if (!anchor) {
          out.push(d.getTime());
        } else {
          const days = Math.floor((d.getTime() - anchor) / 86400000);
          const weeks = Math.floor(days / 7);
          if (weeks % 2 === 0) out.push(d.getTime());
        }
      }
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  if (recurrence.type === 'monthly_fixed_day') {
    const day = Number(recurrence.dayOfMonth || 0);
    if (!day) return [];
    const out = [];
    const cursor = new Date(ws);
    cursor.setDate(1);
    cursor.setHours(12, 0, 0, 0);
    for (let guard = 0; guard < 24 && cursor.getTime() <= we + 86400000; guard++) {
      const y = cursor.getFullYear();
      const m = cursor.getMonth();
      const last = new Date(y, m + 1, 0).getDate();
      const clamped = Math.min(Math.max(day, 1), last);
      const t = new Date(y, m, clamped, 12, 0, 0, 0).getTime();
      if (t >= ws && t <= we) out.push(t);
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return out;
  }

  if (recurrence.type === 'annual_fixed') {
    const month = Number(recurrence.month);
    const day = Number(recurrence.day);
    if (
      !Number.isFinite(month) ||
      month < 0 ||
      month > 11 ||
      !Number.isFinite(day) ||
      day < 1
    ) {
      return [];
    }
    const out = [];
    const startYear = new Date(ws).getFullYear();
    for (let y = startYear - 1; y <= startYear + 2; y++) {
      const last = new Date(y, month + 1, 0).getDate();
      const dd = Math.min(Math.max(day, 1), last);
      const t = new Date(y, month, dd, 12, 0, 0, 0).getTime();
      if (t >= ws && t <= we) out.push(t);
    }
    return out;
  }

  return [];
}

function cloneRecurringInstanceFromTemplate(template, anchorDueMs, newTodoId) {
  const rec = effectiveRecurrence(template);
  const oldParentDue = Number(template?.dueDate || 0) || null;
  const newParentDue = Number(anchorDueMs) || null;
  const rid = String(template.recurringId || template.id || '');
  const subs = getSubtasks(template).map((s) => ({
    ...s,
    id: newSubtaskId(),
    done: false,
    doneAt: null,
    dueDate: projectSubtaskDueDateForNewCycle(oldParentDue, newParentDue, s.dueDate),
  }));
  return {
    id: newTodoId(),
    text: template.text || '',
    done: false,
    doneAt: null,
    pinned: false,
    recurring: true,
    recurringId: rid,
    recurrence: template.recurrence || rec,
    dueDate: anchorDueMs,
    assigneeEmails: Array.isArray(template.assigneeEmails)
      ? template.assigneeEmails.filter(Boolean)
      : [],
    subtasks: subs,
  };
}

/**
 * Append missing recurring primary rows (and reset sub-tasks) when an occurrence
 * falls inside the billing window but no row exists for that series + due day.
 *
 * @param {Record<string, { closed?: boolean, items?: unknown[] }>} cycleDataByCategory
 * @returns {{ cycleDataByCategory: typeof cycleDataByCategory, changed: boolean }}
 */
export function reconcileRecurringTodoInstances(
  cycleDataByCategory,
  cycleStartMs,
  cycleEndMs,
  newTodoId,
) {
  let changed = false;
  const next = { ...cycleDataByCategory };

  for (const catKey of Object.keys(next)) {
    const cat = next[catKey] || { closed: false, items: [] };
    const items = Array.isArray(cat.items) ? [...cat.items] : [];

    const templatesByRid = new Map();
    for (const it of items) {
      if (!it || !it.recurring) continue;
      const rid = stableRecurringSeriesId(it);
      if (!rid) continue;
      const prev = templatesByRid.get(rid);
      if (!prev || Number(it.dueDate || 0) > Number(prev.dueDate || 0)) {
        templatesByRid.set(rid, it);
      }
    }

    let itemsMut = items;
    let catChanged = false;
    for (const [, template] of templatesByRid) {
      const rec = effectiveRecurrence(template);
      if (!rec?.type) continue;
      const anchors = listRecurringAnchorsInWindow(rec, cycleStartMs, cycleEndMs);
      for (const anchorMs of anchors) {
        const exists = itemsMut.some(
          (it) =>
            it &&
            it.recurring &&
            stableRecurringSeriesId(it) === stableRecurringSeriesId(template) &&
            sameCalendarDay(it.dueDate, anchorMs),
        );
        if (exists) continue;
        const fresh = cloneRecurringInstanceFromTemplate(template, anchorMs, newTodoId);
        itemsMut = [...itemsMut, fresh];
        catChanged = true;
      }
    }

    if (catChanged) {
      next[catKey] = { ...cat, items: itemsMut };
      changed = true;
    }
  }

  return { cycleDataByCategory: next, changed };
}

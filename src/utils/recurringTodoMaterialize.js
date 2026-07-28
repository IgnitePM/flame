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

function recurringAnchorDayStamp(ms) {
  const n = Number(ms || 0);
  if (!n) return '';
  return new Date(n).toDateString();
}

export function recurringAnchorKey(recurringId, dueDateMs) {
  const rid = String(recurringId || '').trim();
  const stamp = recurringAnchorDayStamp(dueDateMs);
  if (!rid || !stamp) return '';
  return `${rid}__${stamp}`;
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

/** First due date for a recurrence rule inside a billing cycle window. */
export function computeRecurringDueDate(recurrence, cycleStart) {
  if (!recurrence || !recurrence.type) return null;
  const base = new Date(cycleStart);
  base.setHours(12, 0, 0, 0);
  const cycleStartMs = base.getTime();

  if (recurrence.type === 'daily_fixed') {
    return cycleStartMs;
  }

  if (recurrence.type === 'monthly_fixed_day') {
    const day = Number(recurrence.dayOfMonth || 0);
    if (!day) return null;
    const atMonth = (year, month) => {
      const lastDay = new Date(year, month + 1, 0).getDate();
      const clamped = Math.min(Math.max(day, 1), lastDay);
      return new Date(year, month, clamped, 12, 0, 0, 0).getTime();
    };
    let t = atMonth(base.getFullYear(), base.getMonth());
    if (t < cycleStartMs) t = atMonth(base.getFullYear(), base.getMonth() + 1);
    return t;
  }

  const getNextWeekday = (weekday) => {
    const wd = Number(weekday);
    if (!Number.isFinite(wd) || wd < 0 || wd > 6) return null;
    const d = new Date(base);
    for (let step = 0; step < 7; step++) {
      if (d.getDay() === wd) return d.getTime();
      d.setDate(d.getDate() + 1);
    }
    return null;
  };

  if (recurrence.type === 'weekly_weekday') {
    return getNextWeekday(recurrence.weekday);
  }

  if (recurrence.type === 'biweekly_weekday') {
    const first = getNextWeekday(recurrence.weekday);
    if (!first) return null;
    const anchor = Number(recurrence.anchorMs || 0);
    if (!anchor) return first;
    const daysBetween = Math.floor((first - anchor) / 86400000);
    const weeksBetween = Math.floor(daysBetween / 7);
    return weeksBetween % 2 === 0 ? first : first + 7 * 86400000;
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
      return null;
    }
    const tryYear = (y) => {
      const last = new Date(y, month + 1, 0).getDate();
      const dd = Math.min(Math.max(day, 1), last);
      return new Date(y, month, dd, 12, 0, 0, 0).getTime();
    };
    let t = tryYear(base.getFullYear());
    if (t < cycleStartMs) t = tryYear(base.getFullYear() + 1);
    return t;
  }

  return null;
}

function shouldSubtaskPersistIntoNextCycle(sub) {
  return !!sub?.recurring || !sub?.done;
}

/** Best recurring template per series — prefer open instances, then latest due date. */
export function collectRecurringSeriesTemplates(items) {
  const map = new Map();
  for (const it of items || []) {
    if (!it?.recurring) continue;
    const rid = stableRecurringSeriesId(it);
    if (!rid) continue;
    const prev = map.get(rid);
    if (!prev) {
      map.set(rid, it);
      continue;
    }
    const prevOpen = !prev.done;
    const itOpen = !it.done;
    if (itOpen && !prevOpen) {
      map.set(rid, it);
      continue;
    }
    if (!itOpen && prevOpen) continue;
    if (Number(it.dueDate || 0) > Number(prev.dueDate || 0)) {
      map.set(rid, it);
    }
  }
  return [...map.values()];
}

/** True when a recurring row already represents this series on the anchor day. */
export function recurringInstanceExistsForAnchor(items, recurringId, anchorMs) {
  const rid = String(recurringId || '').trim();
  if (!rid) return false;
  const anchor = Number(anchorMs || 0);
  return (items || []).some((it) => {
    if (!it?.recurring) return false;
    if (stableRecurringSeriesId(it) !== rid) return false;
    if (!anchor) return true;
    if (!it.dueDate) return true; // undated open/carried copy of the series
    return sameCalendarDay(it.dueDate, anchor);
  });
}

/** True when any incomplete instance of this recurring series is already present. */
export function openRecurringInstanceExists(items, recurringId) {
  const rid = String(recurringId || '').trim();
  if (!rid) return false;
  return (items || []).some(
    (it) =>
      it?.recurring &&
      !it.done &&
      stableRecurringSeriesId(it) === rid,
  );
}

function buildRecurringSeedRow(template, cycleStartMs, newTodoId) {
  const effectiveRecurrence =
    template.recurrence ||
    (template.dueDate
      ? {
          type: 'monthly_fixed_day',
          dayOfMonth: new Date(template.dueDate).getDate(),
        }
      : null);
  const newParentDue = computeRecurringDueDate(effectiveRecurrence, cycleStartMs);
  return {
    id: newTodoId(),
    text: template.text,
    done: false,
    doneAt: null,
    pinned: false,
    recurring: true,
    recurringId: template.recurringId || template.id,
    assigneeEmails: Array.isArray(template.assigneeEmails)
      ? template.assigneeEmails.filter(Boolean)
      : [],
    recurrence: template.recurrence || effectiveRecurrence,
    dueDate: newParentDue,
    subtasks: projectSubtasksForNewRecurringPrimaryCycle(
      template,
      newParentDue,
      cycleStartMs,
    ),
  };
}

/** One fresh recurring occurrence per series for the target billing cycle. */
export function buildRecurringSeedsForCycle(templates, cycleStartMs, newTodoId) {
  return (templates || [])
    .map((template) => buildRecurringSeedRow(template, cycleStartMs, newTodoId))
    .filter((seed) => !!seed.dueDate || !!seed.recurrence?.type);
}

/** Keep the earliest open occurrence of each recurring series; drop later duplicates. */
export function pruneDuplicateOpenRecurringInstances(items) {
  const list = Array.isArray(items) ? items : [];
  const openByRid = new Map();
  for (const it of list) {
    if (!it?.recurring || it.done) continue;
    const rid = stableRecurringSeriesId(it);
    if (!rid) continue;
    if (!openByRid.has(rid)) openByRid.set(rid, []);
    openByRid.get(rid).push(it);
  }
  const dropIds = new Set();
  for (const [, group] of openByRid) {
    if (group.length < 2) continue;
    group.sort((a, b) => {
      const ad = Number(a.dueDate || 0);
      const bd = Number(b.dueDate || 0);
      if (ad && bd && ad !== bd) return ad - bd;
      if (ad && !bd) return -1;
      if (!ad && bd) return 1;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
    for (let i = 1; i < group.length; i++) {
      if (group[i]?.id) dropIds.add(group[i].id);
    }
  }
  if (!dropIds.size) return { items: list, changed: false };
  return {
    items: list.filter((it) => !dropIds.has(it?.id)),
    changed: true,
  };
}

/**
 * Merge carry-forward open tasks and missing recurring seeds into one category.
 * Safe to call when the cycle bucket already exists (backfills gaps).
 */
export function materializeCategoryTodoFromPrev(
  prevCat,
  existingCat,
  cycleStartMs,
  newTodoId,
) {
  const prevItems = prevCat?.items || [];
  const existing = existingCat || { closed: false, items: [] };
  let items = [...(existing.items || [])];
  let changed = false;

  const existingIds = new Set(items.map((item) => item?.id).filter(Boolean));
  for (const item of prevItems.filter((row) => row && !row.done)) {
    if (!item.id || existingIds.has(item.id)) continue;
    items.push(carryPrimaryTodoItemFromPrevCycle(item));
    existingIds.add(item.id);
    changed = true;
  }

  const templates = collectRecurringSeriesTemplates(prevItems);
  const seeds = buildRecurringSeedsForCycle(templates, cycleStartMs, newTodoId);
  const dedupedSeeds = dedupeRecurringSeedsAgainstCarried(
    items.filter((row) => row && !row.done),
    seeds,
  );
  const seedsToAdd = dedupedSeeds.filter((seed) => {
    const rid = stableRecurringSeriesId(seed);
    if (!rid) return true;
    if (openRecurringInstanceExists(items, rid)) return false;
    const anchor = Number(seed.dueDate || 0);
    if (!anchor) return true;
    return !recurringInstanceExistsForAnchor(items, rid, anchor);
  });

  if (seedsToAdd.length) {
    items = [...items, ...seedsToAdd];
    changed = true;
  }

  const pruned = pruneDuplicateOpenRecurringInstances(items);
  if (pruned.changed) {
    items = pruned.items;
    changed = true;
  }

  if (!changed) {
    return { category: existing, changed: false };
  }
  return {
    category: { ...existing, closed: false, items },
    changed: true,
  };
}

/**
 * Carry open tasks and seed recurring occurrences for every category in a cycle.
 */
export function materializeCycleTodoFromPrev(
  existingCycleData,
  prevCycleData,
  cycleStartMs,
  newTodoId,
  categoryKeys = [],
) {
  const prev = prevCycleData || {};
  const existing = existingCycleData || {};
  const keys = new Set([
    ...Object.keys(existing),
    ...Object.keys(prev),
    ...categoryKeys,
  ]);
  const next = { ...existing };
  let changed = false;

  for (const catKey of keys) {
    const { category, changed: catChanged } = materializeCategoryTodoFromPrev(
      prev[catKey],
      next[catKey],
      cycleStartMs,
      newTodoId,
    );
    if (catChanged) {
      next[catKey] = category;
      changed = true;
    }
  }

  return { cycleData: changed ? next : existing, changed };
}

/** Keep incomplete and recurring sub-tasks when carrying a primary row forward. */
export function subtasksForCarryover(parentItem) {
  return getSubtasks(parentItem)
    .filter(shouldSubtaskPersistIntoNextCycle)
    .map((sub) => ({ ...sub, done: false, doneAt: null }));
}

/** Sub-tasks for a newly materialized recurring primary in the next billing cycle. */
export function projectSubtasksForNewRecurringPrimaryCycle(
  oldParentItem,
  newParentDueMs,
  cycleStartMs,
) {
  const oldParentDue = Number(oldParentItem?.dueDate || 0);
  return getSubtasks(oldParentItem)
    .filter(shouldSubtaskPersistIntoNextCycle)
    .map((sub) => {
      let dueDate = projectSubtaskDueDateForNewCycle(
        oldParentDue,
        newParentDueMs,
        sub.dueDate,
      );
      if (sub.recurring) {
        const rec = effectiveRecurrence(sub);
        const nextDue = computeRecurringDueDate(rec, cycleStartMs);
        if (nextDue) dueDate = clampSubtaskDueToParentProxy(newParentDueMs, nextDue);
      }
      return {
        ...sub,
        id: newSubtaskId(),
        done: false,
        doneAt: null,
        dueDate,
        recurring: !!sub.recurring,
        recurringId: sub.recurring ? sub.recurringId || sub.id : null,
        recurrence: sub.recurrence || (sub.recurring ? effectiveRecurrence(sub) : null),
      };
    });
}

function clampSubtaskDueToParentProxy(parentDueMs, subDueMs) {
  const cap = Number(parentDueMs || 0);
  const sub = Number(subDueMs || 0);
  if (!cap) return sub || null;
  if (!sub) return null;
  return Math.min(sub, cap);
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
    // Without a stored anchor, the first matching weekday in the window
    // becomes the anchor — otherwise every week would match (weekly cadence).
    let anchor = Number(recurrence.anchorMs || 0);
    const out = [];
    const d = new Date(ws);
    d.setHours(12, 0, 0, 0);
    for (let guard = 0; guard < 800 && d.getTime() <= we; guard++) {
      if (d.getDay() === wd) {
        if (!anchor) {
          anchor = d.getTime();
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
  // Same carry semantics as new-cycle materialization: recurring sub-tasks
  // reset, unfinished one-time sub-tasks persist, completed one-time
  // sub-tasks stay done (don't resurrect them on the next occurrence).
  const subs = getSubtasks(template)
    .filter(shouldSubtaskPersistIntoNextCycle)
    .map((s) => ({
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
    const skipped = Array.isArray(cat.skippedRecurringAnchors)
      ? cat.skippedRecurringAnchors
      : [];
    const skippedSet = new Set(
      skipped
        .map((k) => String(k || '').trim())
        .filter(Boolean),
    );

    const templatesByRid = new Map();
    for (const it of collectRecurringSeriesTemplates(items)) {
      const rid = stableRecurringSeriesId(it);
      if (rid) templatesByRid.set(rid, it);
    }

    let itemsMut = items;
    let catChanged = false;

    const pruned = pruneDuplicateOpenRecurringInstances(itemsMut);
    if (pruned.changed) {
      itemsMut = pruned.items;
      catChanged = true;
    }

    for (const [, template] of templatesByRid) {
      const rec = effectiveRecurrence(template);
      if (!rec?.type) continue;
      const anchors = listRecurringAnchorsInWindow(rec, cycleStartMs, cycleEndMs);
      const seriesId = stableRecurringSeriesId(template);
      // Don't spawn the next occurrence while an earlier one is still open —
      // that stacks "this month" and "next month" in Due soon lists.
      if (openRecurringInstanceExists(itemsMut, seriesId)) continue;

      for (const anchorMs of anchors) {
        const skipKey = recurringAnchorKey(seriesId, anchorMs);
        if (skipKey && skippedSet.has(skipKey)) continue;
        const exists = recurringInstanceExistsForAnchor(
          itemsMut,
          seriesId,
          anchorMs,
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

/**
 * Drop newly seeded recurring rows when an open instance of the same series
 * already exists (carried or otherwise). Without this, rollover can show both
 * this month's unfinished task and next month's freshly seeded occurrence.
 */
export function dedupeRecurringSeedsAgainstCarried(carriedItems, seedItems) {
  const openRids = new Set();
  (carriedItems || []).forEach((it) => {
    if (!it?.recurring || it.done) return;
    const rid = stableRecurringSeriesId(it);
    if (rid) openRids.add(rid);
  });

  return (seedItems || []).filter((seed) => {
    const rid = stableRecurringSeriesId(seed);
    if (!rid) return true;
    return !openRids.has(rid);
  });
}

/** Carry a single open primary row from the prior cycle into the current cycle view. */
export function carryPrimaryTodoItemFromPrevCycle(item) {
  return {
    ...item,
    done: false,
    pinned: false,
    assigneeEmails: Array.isArray(item.assigneeEmails)
      ? item.assigneeEmails.filter(Boolean)
      : [],
    subtasks: subtasksForCarryover(item),
  };
}

/**
 * When the current billing cycle already exists in storage, merge in any open
 * primary tasks from the prior cycle that were never copied forward.
 */
export function mergeOpenItemsFromPrevCycle(existingCycleData, prevCycleData) {
  if (!existingCycleData || !prevCycleData) return existingCycleData || {};
  const next = { ...existingCycleData };
  let changed = false;

  for (const [catKey, prevCat] of Object.entries(prevCycleData)) {
    if (!prevCat || typeof prevCat !== 'object') continue;
    const openPrev = (prevCat.items || []).filter((item) => item && !item.done);
    if (!openPrev.length) continue;

    const existingCat = next[catKey] || { closed: false, items: [] };
    const existingIds = new Set((existingCat.items || []).map((item) => item?.id));
    const toAdd = openPrev
      .filter((item) => item?.id && !existingIds.has(item.id))
      .map(carryPrimaryTodoItemFromPrevCycle);
    if (!toAdd.length) continue;

    changed = true;
    next[catKey] = {
      ...existingCat,
      items: [...(existingCat.items || []), ...toAdd],
    };
  }

  return changed ? next : existingCycleData;
}

/** Mark a primary task done/undone in every billing cycle where it exists. */
export function markPrimaryTodoDoneAcrossCycles(
  cycles,
  categoryKey,
  itemId,
  done,
  { recurringSkipKey } = {},
) {
  const next = { ...(cycles || {}) };
  let touched = false;
  const doneAt = done ? Date.now() : null;

  for (const [cycleKey, cycleData] of Object.entries(next)) {
    if (!cycleData || typeof cycleData !== 'object') continue;
    const cat = cycleData[categoryKey];
    if (!cat || !Array.isArray(cat.items)) continue;
    const idx = cat.items.findIndex((item) => item?.id === itemId);
    if (idx < 0) continue;

    touched = true;
    const items = [...cat.items];
    items[idx] = { ...items[idx], done: !!done, doneAt: done ? doneAt : null };

    let skipped = Array.isArray(cat.skippedRecurringAnchors)
      ? [...cat.skippedRecurringAnchors]
      : [];
    if (done && recurringSkipKey && !skipped.includes(recurringSkipKey)) {
      skipped.push(recurringSkipKey);
    }

    next[cycleKey] = {
      ...cycleData,
      [categoryKey]: {
        ...cat,
        items,
        ...(done && recurringSkipKey
          ? { skippedRecurringAnchors: skipped }
          : {}),
      },
    };
  }

  return { cycles: next, touched };
}

/**
 * End a recurring series: remove every open instance across all cycles and
 * strip the recurring flag from completed instances so they remain as history
 * but stop acting as templates for future occurrences.
 */
export function removeRecurringSeriesFromAllCycles(cycles, categoryKey, seriesId) {
  const rid = String(seriesId || '').trim();
  if (!rid) return { cycles: cycles || {}, touched: false };

  const next = { ...(cycles || {}) };
  let touched = false;

  for (const [cycleKey, cycleData] of Object.entries(next)) {
    if (!cycleData || typeof cycleData !== 'object') continue;
    const cat = cycleData[categoryKey];
    if (!cat || !Array.isArray(cat.items)) continue;

    let catTouched = false;
    const items = [];
    for (const it of cat.items) {
      const matches = it?.recurring && stableRecurringSeriesId(it) === rid;
      if (!matches) {
        items.push(it);
        continue;
      }
      catTouched = true;
      if (it.done) {
        // Keep completed history, but stop it from templating new occurrences.
        items.push({ ...it, recurring: false, seriesEnded: true });
      }
      // Open instances are dropped entirely.
    }

    if (catTouched) {
      touched = true;
      next[cycleKey] = {
        ...cycleData,
        [categoryKey]: { ...cat, items },
      };
    }
  }

  return { cycles: next, touched };
}

/**
 * Next occurrence of an item's recurrence after `afterMs`, cloned and ready to
 * insert. Used when deleting the only live instance of a series "occurrence
 * only" — without re-seeding, the series would silently end.
 */
export function seedNextRecurringOccurrence(item, afterMs, newTodoId) {
  if (!item?.recurring) return null;
  const rec = effectiveRecurrence(item);
  if (!rec?.type) return null;
  const base = Number(afterMs || item.dueDate || Date.now());
  const anchors = listRecurringAnchorsInWindow(
    rec,
    base + 86400000,
    base + 400 * 86400000,
  );
  if (!anchors.length) return null;
  return cloneRecurringInstanceFromTemplate(item, anchors[0], newTodoId);
}

/** Remove a primary task id from one category across every stored billing cycle. */
export function removeTodoItemFromAllCycles(
  cycles,
  categoryKey,
  itemId,
  { recurringSkipKey } = {},
) {
  const next = { ...(cycles || {}) };
  let removed = false;
  for (const [cycleKey, cycleData] of Object.entries(next)) {
    if (!cycleData || typeof cycleData !== 'object') continue;
    const cat = cycleData[categoryKey];
    if (!cat || !Array.isArray(cat.items)) continue;
    if (!cat.items.some((i) => i?.id === itemId)) continue;
    removed = true;
    let skipped = Array.isArray(cat.skippedRecurringAnchors)
      ? [...cat.skippedRecurringAnchors]
      : [];
    if (recurringSkipKey && !skipped.includes(recurringSkipKey)) {
      skipped.push(recurringSkipKey);
    }
    next[cycleKey] = {
      ...cycleData,
      [categoryKey]: {
        ...cat,
        items: cat.items.filter((i) => i?.id !== itemId),
        skippedRecurringAnchors: skipped,
      },
    };
  }
  return { cycles: next, removed };
}

/** Ensure recurring reconcile will not respawn a deleted occurrence this cycle. */
export function ensureRecurringSkipOnCategory(
  cycles,
  cycleKey,
  categoryKey,
  skipKey,
) {
  if (!skipKey) return cycles || {};
  const next = { ...(cycles || {}) };
  const cycleData = next[cycleKey] || {};
  const cat = cycleData[categoryKey] || { closed: false, items: [] };
  const skipped = Array.isArray(cat.skippedRecurringAnchors)
    ? [...cat.skippedRecurringAnchors]
    : [];
  if (skipped.includes(skipKey)) return next;
  next[cycleKey] = {
    ...cycleData,
    [categoryKey]: {
      ...cat,
      skippedRecurringAnchors: [...skipped, skipKey],
    },
  };
  return next;
}

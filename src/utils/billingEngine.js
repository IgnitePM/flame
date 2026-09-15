import {
  getEnabledRetainerCategoryNames,
  isRetainerCategoryEnabled,
  isRetainerCategoryDollar,
  carryoverCategoryKey,
  getRetainerCategoryConfiguredMs,
} from './retainerCategories.js';

/**
 * Billing/time math extracted from App.jsx. Pure functions over plain data —
 * no Firebase or React dependencies.
 */

export const GENERAL_LABEL = 'General / Unclassified';

/** Whether tasks/expenses should count toward this retainer line. */
export function isRetainerLineForUsage(client, categoryName) {
  return !!categoryName && isRetainerCategoryEnabled(client, categoryName);
}

/**
 * Hour deduction for a retainer expense. Uses stored equivalentHours when present;
 * otherwise derives from finalCost ÷ client hourly rate (fixes legacy rows and
 * expenses saved before a rate was set).
 */
export function resolveExpenseEquivalentHours(client, expense, categoryName) {
  const cat = categoryName || expense?.category;
  if (!client || !expense || !cat || isRetainerCategoryDollar(client, cat)) return 0;
  const stored = Number(expense.equivalentHours ?? 0);
  if (Number.isFinite(stored) && stored > 0) return stored;
  const finalCost = Number(expense.finalCost ?? expense.rawAmount ?? 0);
  const rate = Number(client.hourlyRate ?? 0);
  if (finalCost > 0 && rate > 0) return finalCost / rate;
  return 0;
}

/** Hours or dollars to add to category usage for one expense row. */
export function expenseUsageAmount(client, expense, categoryName) {
  const cat = categoryName || expense?.category;
  if (!client || !expense || !cat) return 0;
  if (isRetainerCategoryDollar(client, cat)) {
    return Number(expense.finalCost ?? 0);
  }
  return resolveExpenseEquivalentHours(client, expense, cat);
}

/** Shift ids that are still open (employee clocked in or on break). */
export function getLiveShiftIdSet(timesheets = []) {
  return new Set(
    (timesheets || [])
      .filter((s) => s && (s.status === 'active' || s.status === 'break'))
      .map((s) => s.id),
  );
}

export const getTaskDuration = (task, options = {}) => {
  const liveShiftIds = options.liveShiftIds;
  const shiftIsLive =
    !liveShiftIds ||
    liveShiftIds.size === 0 ||
    (task?.shiftId && liveShiftIds.has(task.shiftId));

  if (task == null || typeof task !== 'object') return 0;
  if (task.status === 'active') {
    if (!shiftIsLive) {
      return Number(task.totalSavedDuration ?? task.duration ?? 0);
    }
    return (
      (task.totalSavedDuration || 0) +
      (Date.now() - (task.lastResumeTime || task.clockInTime))
    );
  }
  if (task.status === 'completed') {
    return Number(task.duration ?? task.totalSavedDuration ?? 0);
  }
  // Legacy rows: clocked out but missing status still use stored duration.
  const cin = Number(task.clockInTime || 0);
  const out = Number(task.clockOutTime || 0);
  if (out > cin) {
    return Number(task.duration ?? task.totalSavedDuration ?? 0);
  }
  if (!shiftIsLive) {
    return Number(task.totalSavedDuration ?? task.duration ?? 0);
  }
  return (
    (task.totalSavedDuration || 0) +
    (Date.now() - (task.lastResumeTime || task.clockInTime))
  );
};

export const formatTime = (ms) => {
  if (!ms || ms < 0) return '0h 0m';
  const totalMins = Math.floor(ms / 60000);
  return `${Math.floor(totalMins / 60)}h ${totalMins % 60}m`;
};

// Dynamic Billing Period & Global Carryover Logic.
// billingDay 29-31 is clamped to the last day of short months so cycle
// boundaries never roll into the wrong month (e.g. Feb 31 → Mar 3).
const clampBillingDay = (y, m, d) => {
  const norm = new Date(y, m, 1); // normalize month overflow/underflow
  const daysInMonth = new Date(norm.getFullYear(), norm.getMonth() + 1, 0).getDate();
  return Math.min(d, daysInMonth);
};

/** Start timestamp of the billing cycle that begins on billingDay in year/month. */
export const billingCycleStartAt = (billingDay, year, month) => {
  let y = year;
  let m = month;
  while (m < 0) {
    m += 12;
    y--;
  }
  while (m > 11) {
    m -= 12;
    y++;
  }
  return new Date(y, m, clampBillingDay(y, m, billingDay), 0, 0, 0, 0).getTime();
};

/** Next cycle start after `cycleStartMs` (exclusive end of that cycle). */
export const nextBillingCycleStart = (billingDay, cycleStartMs) => {
  const d = new Date(cycleStartMs);
  return billingCycleStartAt(billingDay, d.getFullYear(), d.getMonth() + 1);
};

/** Previous cycle start before `cycleStartMs`. */
export const prevBillingCycleStart = (billingDay, cycleStartMs) => {
  const d = new Date(cycleStartMs);
  return billingCycleStartAt(billingDay, d.getFullYear(), d.getMonth() - 1);
};

export const getBillingPeriod = (billingDay = 1, offsetMonths = 0) => {
  const now = new Date();
  let currentMonth = now.getMonth();
  let currentYear = now.getFullYear();

  if (now.getDate() < clampBillingDay(currentYear, currentMonth, billingDay)) {
    currentMonth--;
  }
  currentMonth += offsetMonths;

  while (currentMonth < 0) {
    currentMonth += 12;
    currentYear--;
  }
  while (currentMonth > 11) {
    currentMonth -= 12;
    currentYear++;
  }

  const start = billingCycleStartAt(billingDay, currentYear, currentMonth);
  // End = the instant before the next cycle starts.
  const end = nextBillingCycleStart(billingDay, start) - 1;

  return { start, end };
};

/**
 * Retainer usage stats for one client and billing window.
 * `deps` carries the activity collections: { taskLogs, expenses, addons }.
 */
export const computeGlobalRetainerStats = (client, mStart, mEnd, deps) => {
  const { taskLogs = [], expenses = [], addons = [], timesheets = [] } = deps || {};
  const liveShiftIds = getLiveShiftIdSet(timesheets);
  const durationOf = (t) => getTaskDuration(t, { liveShiftIds });
  const isDollarCategory = isRetainerCategoryDollar;

  /** Split add-on hours across hour retainer lines; matched category gets full amount, else even split. */
  const allocateAddonHoursByCategory = (addonRows) => {
    const hourCats = getEnabledRetainerCategoryNames(client).filter(
      (cat) => !isDollarCategory(client, cat),
    );
    const alloc = {};
    hourCats.forEach((c) => {
      alloc[c] = 0;
    });
    if (!hourCats.length) return alloc;
    addonRows.forEach((a) => {
      const h = Number(a.hours || 0);
      if (!Number.isFinite(h) || h <= 0) return;
      const cat = a.category;
      if (
        cat &&
        client.retainers?.[cat] != null &&
        !isDollarCategory(client, cat)
      ) {
        alloc[cat] = (alloc[cat] || 0) + h;
      } else {
        const share = h / hourCats.length;
        hourCats.forEach((c) => {
          alloc[c] += share;
        });
      }
    });
    return alloc;
  };

  const clientStartMs = client.clientStartDate || 0;
  const globalResetMs = client.lastCarryoverResetDate || 0;
  const perCategoryReset = client.carryoverResetByCategory || {};

  const billingDay = client.billingDay || 1;

  // Activity rows are matched by clientId when stamped (rename-safe);
  // legacy rows fall back to the name match.
  const rowBelongsToClient = (row) =>
    row.clientId ? row.clientId === client.id : row.clientName === client.name;

  // Add-ons bought for a specific cycle count toward that cycle even when
  // purchased on a different date; legacy rows fall back to purchase date.
  const addonInWindow = (a, winStart, winEndExclusive) => {
    const cycleStart = Number(a.billingCycleStart);
    if (Number.isFinite(cycleStart) && cycleStart > 0) {
      return cycleStart >= winStart && cycleStart < winEndExclusive;
    }
    return a.date >= winStart && a.date < winEndExclusive;
  };

  const retainerCategories = getEnabledRetainerCategoryNames(client);
  const normalizeCategory = (value) =>
    String(value || '').trim().toLowerCase();
  const categoryByNormalized = retainerCategories.reduce((acc, cat) => {
    acc[normalizeCategory(cat)] = cat;
    return acc;
  }, {});
  const canonicalCategory = (value) => {
    const key = normalizeCategory(value);
    return categoryByNormalized[key] || String(value || '');
  };
  const perCategory = {};

  const getEffectiveStartMs = (effectiveResetMs, firstActivityMs) => {
    // Per-category only: never inherit the client's global start date when this
    // category has no logged activity (avoids false carryover on newly added lines).
    if (!effectiveResetMs && !firstActivityMs) return 0;
    return Math.max(Number(effectiveResetMs || 0), Number(firstActivityMs || 0)) || 0;
  };

  const isPaused = client.status === 'paused';

  // Compute carryover per category (hours and dollars) so each category can show
  // base + carryover like the combined pool.
  retainerCategories.forEach((cat) => {
    const base = Number(client.retainers?.[cat] || 0);
    const catResetMs = Number(perCategoryReset[carryoverCategoryKey(cat)] || 0);
    const catConfiguredMs = getRetainerCategoryConfiguredMs(client, cat);
    const effectiveResetMs = Math.max(globalResetMs, catResetMs, catConfiguredMs);

    const catIsDollar = isDollarCategory(client, cat);

    let pastTasksCat = [];
    if (!catIsDollar) {
      pastTasksCat = taskLogs.filter(
        (t) =>
          rowBelongsToClient(t) &&
          t.clockInTime < mStart &&
          !t.projectId &&
          canonicalCategory(t.projectName) === cat,
      );
    }

    let pastExpsCat = expenses.filter(
      (e) =>
        rowBelongsToClient(e) &&
        e.date < mStart &&
        !e.projectId &&
        canonicalCategory(e.category) === cat,
    );

    if (clientStartMs) {
      if (!catIsDollar) {
        pastTasksCat = pastTasksCat.filter((t) => t.clockInTime >= clientStartMs);
      }
      pastExpsCat = pastExpsCat.filter((e) => e.date >= clientStartMs);
    }
    if (effectiveResetMs) {
      if (!catIsDollar) {
        pastTasksCat = pastTasksCat.filter((t) => t.clockInTime >= effectiveResetMs);
      }
      pastExpsCat = pastExpsCat.filter((e) => e.date >= effectiveResetMs);
    }

    const firstTaskTime =
      !catIsDollar && pastTasksCat.length > 0
        ? Math.min(...pastTasksCat.map((t) => t.clockInTime))
        : null;
    const firstExpTime =
      pastExpsCat.length > 0 ? Math.min(...pastExpsCat.map((e) => e.date)) : null;

    let firstActivityMs = null;
    if (firstTaskTime && firstExpTime) firstActivityMs = Math.min(firstTaskTime, firstExpTime);
    else if (firstTaskTime) firstActivityMs = firstTaskTime;
    else if (firstExpTime) firstActivityMs = firstExpTime;

    const effectiveStartMs = getEffectiveStartMs(effectiveResetMs, firstActivityMs);
    if (!effectiveStartMs) {
      perCategory[cat] = {
        isDollar: catIsDollar,
        baseActive: isPaused ? 0 : base,
        carryover: 0,
      };
      return;
    }

    // Carryover = ending remaining from prior cycles (rolling), not base−usage.
    // Walking every completed cycle since the category became active means a
    // deficit that started earlier keeps compounding instead of resetting when
    // a later cycle is merely "over base but under available."
    if (effectiveStartMs >= mStart) {
      perCategory[cat] = {
        isDollar: catIsDollar,
        baseActive: isPaused ? 0 : base,
        carryover: 0,
      };
      return;
    }

    // Rewind to the billing cycle that contains (or starts at) effectiveStartMs.
    let walkStart = mStart;
    let guard = 0;
    while (walkStart > effectiveStartMs && guard < 240) {
      walkStart = prevBillingCycleStart(billingDay, walkStart);
      guard += 1;
    }

    let carry = 0;
    let pStart = walkStart;
    guard = 0;
    while (pStart < mStart && guard < 240) {
      guard += 1;
      const pEnd = nextBillingCycleStart(billingDay, pStart);
      if (pEnd <= pStart) break;

      if (effectiveStartMs >= pEnd) {
        pStart = pEnd;
        continue;
      }

      const periodLen = pEnd - pStart;
      const allotted =
        effectiveStartMs <= pStart
          ? base
          : base * ((pEnd - Math.max(effectiveStartMs, pStart)) / periodLen);

      const periodTasks = !catIsDollar
        ? pastTasksCat.filter(
            (t) => t.clockInTime >= pStart && t.clockInTime < pEnd,
          )
        : [];
      const periodExps = pastExpsCat.filter(
        (e) => e.date >= pStart && e.date < pEnd,
      );

      const periodTaskHours = !catIsDollar
        ? periodTasks.reduce((acc, t) => acc + durationOf(t), 0) / 3600000
        : 0;
      const periodExpUsed = catIsDollar
        ? periodExps.reduce((acc, e) => acc + Number(e.finalCost || 0), 0)
        : periodExps.reduce(
            (acc, e) => acc + resolveExpenseEquivalentHours(client, e, cat),
            0,
          );

      const periodAddons = addons
        .filter((a) => a.clientId === client.id && addonInWindow(a, pStart, pEnd))
        .filter((a) => !clientStartMs || a.date >= clientStartMs)
        .filter((a) => !effectiveResetMs || a.date >= effectiveResetMs);
      const periodAddonByCat = allocateAddonHoursByCategory(periodAddons);
      const periodAddon = catIsDollar ? 0 : Number(periodAddonByCat[cat] || 0);

      let periodMove = 0;
      if (!catIsDollar) {
        const periodMoves = client.retainerHourMovesByCycle?.[String(pStart)] || [];
        periodMoves.forEach((m) => {
          const h = Number(m.hours || 0);
          if (!Number.isFinite(h) || h <= 0 || m.from === m.to) return;
          if (m.from === cat) periodMove -= h;
          if (m.to === cat) periodMove += h;
        });
      }

      const available = allotted + carry + periodAddon + periodMove;
      carry = available - (periodTaskHours + periodExpUsed);
      pStart = pEnd;
    }

    perCategory[cat] = {
      isDollar: catIsDollar,
      baseActive: isPaused ? 0 : base,
      carryover: carry,
    };
  });

  const timelineEndMs = (t) => {
    if (t.status === 'active') {
      const shiftLive =
        liveShiftIds.size === 0 || (t.shiftId && liveShiftIds.has(t.shiftId));
      if (!shiftLive) {
        const cin = Number(t.clockInTime || 0);
        return cin + durationOf(t);
      }
      return Date.now();
    }
    const cin = Number(t.clockInTime || 0);
    const out = Number(t.clockOutTime || 0);
    if (out >= cin) return out;
    return cin + durationOf(t);
  };

  const taskOverlapsBillingWindow = (t) => {
    const start = Number(t.clockInTime || 0);
    if (!start) return false;
    const end = timelineEndMs(t);
    return start <= mEnd && end >= mStart;
  };

  /** Hours attributed to [mStart, mEnd] (prorates tasks that cross cycle boundaries; includes active tasks via durationOf). */
  const hoursInBillingWindow = (t) => {
    const totalMs = durationOf(t);
    if (!totalMs || totalMs <= 0) return 0;
    const start = Number(t.clockInTime || 0);
    if (!start) return 0;
    const end = timelineEndMs(t);
    const span = end - start;
    if (span <= 0) return 0;
    const overlapStart = Math.max(start, mStart);
    const overlapEnd = Math.min(end, mEnd);
    if (overlapEnd <= overlapStart) return 0;
    return (totalMs * (overlapEnd - overlapStart)) / span / 3600000;
  };

  const currentTasks = taskLogs.filter(
    (t) =>
      rowBelongsToClient(t) &&
      !t.projectId &&
      taskOverlapsBillingWindow(t),
  );
  const currentExps = expenses.filter(e => rowBelongsToClient(e) && e.date >= mStart && e.date <= mEnd && !e.projectId);
  const currentAddons = addons.filter(a => a.clientId === client.id && addonInWindow(a, mStart, mEnd + 1));
  const currentAddonHours = currentAddons.reduce((acc, a) => acc + Number(a.hours), 0);
  const currAddonByCat = allocateAddonHoursByCategory(currentAddons);

  const moves = client.retainerHourMovesByCycle?.[String(mStart)] || [];
  const netMove = {};
  retainerCategories.forEach((cat) => {
    netMove[cat] = 0;
  });
  moves.forEach((m) => {
    const h = Number(m.hours || 0);
    if (!Number.isFinite(h) || h <= 0 || m.from === m.to) return;
    if (!m.from || !m.to) return;
    if (!retainerCategories.includes(m.from) || !retainerCategories.includes(m.to))
      return;
    if (isDollarCategory(client, m.from) || isDollarCategory(client, m.to)) return;
    netMove[m.from] = (netMove[m.from] || 0) - h;
    netMove[m.to] = (netMove[m.to] || 0) + h;
  });

  const categoryBreakdown = {};

  currentTasks.forEach((t) => {
    if (t.projectName === GENERAL_LABEL) return;
    const cat = canonicalCategory(t.projectName);
    if (!isRetainerLineForUsage(client, cat)) return;
    categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + hoursInBillingWindow(t);
  });

  // Dollar categories use finalCost; hour categories use equivalentHours.
  currentExps.forEach((e) => {
    const cat = canonicalCategory(e.category);
    if (!isRetainerLineForUsage(client, cat)) return;
    categoryBreakdown[cat] =
      (categoryBreakdown[cat] || 0) + expenseUsageAmount(client, e, cat);
  });

  // Finalize per-category totals: base + rolling carryover + this-cycle add-ons + hour moves.
  // Prior-cycle add-ons are already reflected inside carryover (ending remaining), so they
  // must not be added again here.
  Object.keys(perCategory).forEach((cat) => {
    const used = Number(categoryBreakdown?.[cat] || 0);
    const baseActive = Number(perCategory[cat]?.baseActive || 0);
    const catCarry = Number(perCategory[cat]?.carryover || 0);
    const currAdd = Number(currAddonByCat[cat] || 0);
    const move = Number(netMove[cat] || 0);
    const adjustedAllottedCat = baseActive + catCarry + currAdd + move;
    perCategory[cat] = {
      ...perCategory[cat],
      used,
      // Kept for older UI callers; always 0 so it is not shown as a separate additive line.
      addonHoursPriorCycle: 0,
      addonHoursThisCycle: currAdd,
      hourMoveNet: move,
      adjustedAllotted: adjustedAllottedCat,
      isOver: adjustedAllottedCat > 0 ? used > adjustedAllottedCat : used > 0,
      percent:
        adjustedAllottedCat > 0
          ? Math.min(Math.max((used / adjustedAllottedCat) * 100, 0), 100)
          : used > 0
            ? 100
            : 0,
    };
  });

  const hourCats = retainerCategories.filter((cat) => !isDollarCategory(client, cat));
  const activeBase = hourCats.reduce(
    (s, cat) => s + Number(perCategory[cat]?.baseActive || 0),
    0,
  );
  const carryoverSum = hourCats.reduce(
    (s, cat) => s + Number(perCategory[cat]?.carryover || 0),
    0,
  );
  const adjustedAllotted = hourCats.reduce(
    (s, cat) => s + Number(perCategory[cat]?.adjustedAllotted || 0),
    0,
  );
  const usedOnHourRetainerLines = hourCats.reduce(
    (s, cat) => s + Number(categoryBreakdown?.[cat] || 0),
    0,
  );
  const retainerLineNames = new Set(getEnabledRetainerCategoryNames(client));
  const unattributedTaskHours = currentTasks.reduce((acc, t) => {
    const pn = canonicalCategory(t.projectName || '');
    const h = hoursInBillingWindow(t);
    if (!pn || pn === GENERAL_LABEL) return acc + h;
    if (!retainerLineNames.has(pn)) return acc + h;
    return acc;
  }, 0);
  const currentUsed = usedOnHourRetainerLines + unattributedTaskHours;

  return {
    base: activeBase,
    carryover: carryoverSum,
    currentAddons: currentAddonHours,
    adjustedAllotted,
    currentUsed,
    isOver: currentUsed > adjustedAllotted,
    percent:
      adjustedAllotted > 0
        ? Math.min(Math.max((currentUsed / adjustedAllotted) * 100, 0), 100)
        : currentUsed > 0
          ? 100
          : 0,
    categoryBreakdown,
    perCategory,
  };
};

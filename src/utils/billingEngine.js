import {
  getEnabledRetainerCategoryNames,
  isRetainerCategoryEnabled,
  isRetainerCategoryDollar,
} from './retainerCategories.js';

/**
 * Billing/time math extracted from App.jsx. Pure functions over plain data —
 * no Firebase or React dependencies.
 */

export const GENERAL_LABEL = 'General / Unclassified';

export const getTaskDuration = (task) => {
  if (task == null || typeof task !== 'object') return 0;
  if (task.status === 'completed') return task.duration || 0;
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

const carryoverCategoryKey = (cat) =>
  String(cat ?? '').replace(/[~*[\]/]/g, '_').replace(/\./g, '_');

// Dynamic Billing Period & Global Carryover Logic.
// billingDay 29-31 is clamped to the last day of short months so cycle
// boundaries never roll into the wrong month (e.g. Feb 31 → Mar 3).
export const getBillingPeriod = (billingDay = 1, offsetMonths = 0) => {
  const clampDay = (y, m, d) => {
    const norm = new Date(y, m, 1); // normalize month overflow/underflow
    const daysInMonth = new Date(norm.getFullYear(), norm.getMonth() + 1, 0).getDate();
    return Math.min(d, daysInMonth);
  };
  const now = new Date();
  let currentMonth = now.getMonth();
  let currentYear = now.getFullYear();

  if (now.getDate() < clampDay(currentYear, currentMonth, billingDay)) currentMonth--;
  currentMonth += offsetMonths;

  while (currentMonth < 0) { currentMonth += 12; currentYear--; }
  while (currentMonth > 11) { currentMonth -= 12; currentYear++; }

  const start = new Date(
    currentYear, currentMonth, clampDay(currentYear, currentMonth, billingDay), 0, 0, 0, 0,
  ).getTime();

  let nextMonth = currentMonth + 1;
  let nextYear = currentYear;
  if (nextMonth > 11) { nextMonth = 0; nextYear++; }
  // End = the instant before the next cycle starts.
  const end = new Date(
    nextYear, nextMonth, clampDay(nextYear, nextMonth, billingDay), 0, 0, 0, 0,
  ).getTime() - 1;

  return { start, end };
};

/**
 * Retainer usage stats for one client and billing window.
 * `deps` carries the activity collections: { taskLogs, expenses, addons }.
 */
export const computeGlobalRetainerStats = (client, mStart, mEnd, deps) => {
  const { taskLogs = [], expenses = [], addons = [] } = deps || {};
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
  const cycleAnchor = new Date(mStart);
  // Clamp like getBillingPeriod so billingDay 29-31 doesn't roll the
  // previous-cycle anchor into the wrong month.
  const prevStart = (() => {
    let y = cycleAnchor.getFullYear();
    let m = cycleAnchor.getMonth() - 1;
    if (m < 0) { m += 12; y--; }
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    return new Date(y, m, Math.min(billingDay, daysInMonth), 0, 0, 0, 0).getTime();
  })();

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

  const previousCycleAddons = addons
    .filter((a) => a.clientId === client.id && addonInWindow(a, prevStart, mStart))
    .filter((a) => !clientStartMs || a.date >= clientStartMs)
    .filter((a) => !globalResetMs || a.date >= globalResetMs);

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
    // Prefer clientStartDate so allocations accrue even if nothing was logged yet.
    // Fall back to first activity date for legacy clients with no start date.
    const base = clientStartMs || firstActivityMs || 0;
    return Math.max(Number(effectiveResetMs || 0), Number(base || 0)) || 0;
  };

  const isPaused = client.status === 'paused';

  // Compute carryover per category (hours and dollars) so each category can show
  // base + carryover like the combined pool.
  retainerCategories.forEach((cat) => {
    const base = Number(client.retainers?.[cat] || 0);
    const catResetMs = Number(perCategoryReset[carryoverCategoryKey(cat)] || 0);
    const effectiveResetMs = Math.max(globalResetMs, catResetMs);

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

    // Carryover = surplus/deficit from the billing period immediately before this one
    // (not lifetime cumulative). Prorate allotment if the client started mid-period.
    const periodLen = mStart - prevStart;
    if (periodLen <= 0 || effectiveStartMs >= mStart) {
      perCategory[cat] = {
        isDollar: catIsDollar,
        baseActive: isPaused ? 0 : base,
        carryover: 0,
      };
      return;
    }

    const allottedPrev =
      effectiveStartMs <= prevStart
        ? base
        : base * ((mStart - effectiveStartMs) / periodLen);

    const prevTasks = !catIsDollar
      ? pastTasksCat.filter(
          (t) => t.clockInTime >= prevStart && t.clockInTime < mStart,
        )
      : [];
    const prevExps = pastExpsCat.filter((e) => e.date >= prevStart && e.date < mStart);

    const prevTaskHours =
      !catIsDollar
        ? prevTasks.reduce((acc, t) => acc + getTaskDuration(t), 0) / 3600000
        : 0;
    const prevExpUsed = catIsDollar
      ? prevExps.reduce((acc, e) => acc + Number(e.finalCost || 0), 0)
      : prevExps.reduce((acc, e) => acc + Number(e.equivalentHours || 0), 0);

    const carryover = allottedPrev - (prevTaskHours + prevExpUsed);

    perCategory[cat] = {
      isDollar: catIsDollar,
      baseActive: isPaused ? 0 : base,
      carryover,
    };
  });

  const prevAddonByCat = allocateAddonHoursByCategory(previousCycleAddons);

  const timelineEndMs = (t) => {
    if (t.status === 'active') return Date.now();
    const cin = Number(t.clockInTime || 0);
    const out = Number(t.clockOutTime || 0);
    if (out >= cin) return out;
    return cin + getTaskDuration(t);
  };

  const taskOverlapsBillingWindow = (t) => {
    const start = Number(t.clockInTime || 0);
    if (!start) return false;
    const end = timelineEndMs(t);
    return start <= mEnd && end >= mStart;
  };

  /** Hours attributed to [mStart, mEnd] (prorates tasks that cross cycle boundaries; includes active tasks via getTaskDuration). */
  const hoursInBillingWindow = (t) => {
    const totalMs = getTaskDuration(t);
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
    if (!client.retainers?.[cat] || !isRetainerCategoryEnabled(client, cat)) return;
    categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + hoursInBillingWindow(t);
  });

  // Dollar categories use finalCost; hour categories use equivalentHours.
  currentExps.forEach((e) => {
    const cat = canonicalCategory(e.category);
    if (!cat || !client.retainers?.[cat] || !isRetainerCategoryEnabled(client, cat)) return;
    if (isDollarCategory(client, cat)) {
      categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + (Number(e.finalCost) || 0);
    } else {
      categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + (Number(e.equivalentHours) || 0);
    }
  });

  // Finalize per-category totals: base + carryover + prior-cycle add-ons + this cycle add-ons + hour moves.
  Object.keys(perCategory).forEach((cat) => {
    const used = Number(categoryBreakdown?.[cat] || 0);
    const baseActive = Number(perCategory[cat]?.baseActive || 0);
    const catCarry = Number(perCategory[cat]?.carryover || 0);
    const prevAdd = Number(prevAddonByCat[cat] || 0);
    const currAdd = Number(currAddonByCat[cat] || 0);
    const move = Number(netMove[cat] || 0);
    const adjustedAllottedCat = baseActive + catCarry + prevAdd + currAdd + move;
    perCategory[cat] = {
      ...perCategory[cat],
      used,
      addonHoursPriorCycle: prevAdd,
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

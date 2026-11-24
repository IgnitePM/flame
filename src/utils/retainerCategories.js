/**
 * Per-client retainer category enable/disable.
 * Explicit false hides a category everywhere; missing flag falls back to
 * enabled when allocation > 0 (legacy clients keep active categories visible).
 */

export function carryoverCategoryKey(cat) {
  return String(cat ?? '').replace(/[~*[\]/]/g, '_').replace(/\./g, '_');
}

export function getRetainerCategoryConfiguredMs(client, category) {
  const key = carryoverCategoryKey(category);
  const raw =
    client?.retainerCategoryStartDates?.[key] ??
    client?.retainerCategoryStartDates?.[category];
  const n = Number(raw || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Stamp when a category first receives a positive allocation on an existing client. */
export function buildRetainerCategoryStartDates(client, prevClient, now = Date.now()) {
  const out = { ...(prevClient?.retainerCategoryStartDates || {}) };
  for (const cat of getConfiguredRetainerCategoryNames(client)) {
    const key = carryoverCategoryKey(cat);
    if (out[key] || out[cat]) continue;
    const amt = Number(client?.retainers?.[cat] ?? 0);
    if (amt <= 0 || !isRetainerCategoryEnabled(client, cat)) continue;
    const prevAmt = Number(prevClient?.retainers?.[cat] ?? 0);
    if (prevAmt > 0 && isRetainerCategoryEnabled(prevClient, cat)) continue;
    out[key] = now;
  }
  return out;
}

function positiveAmount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

export function isRetainerCategoryEnabled(client, category) {
  if (!category) return false;
  const flags = client?.retainerCategoryEnabled;
  if (flags && typeof flags === 'object') {
    if (flags[category] === false) return false;
    if (flags[category] === true) return true;
  }
  if (positiveAmount(client?.retainers?.[category])) return true;
  if (positiveAmount(client?.retainerAllotmentBaseline?.[category])) return true;
  const schedule = client?.retainerAllotmentSchedule?.[category];
  if (Array.isArray(schedule) && schedule.some((row) => positiveAmount(row?.amount))) {
    return true;
  }
  return false;
}

function scheduleRows(client, category) {
  const rows = client?.retainerAllotmentSchedule?.[category];
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({
      effectiveCycleStart: Number(row?.effectiveCycleStart || 0),
      amount: Number(row?.amount),
    }))
    .filter(
      (row) =>
        row.effectiveCycleStart > 0 && Number.isFinite(row.amount),
    )
    .sort((a, b) => a.effectiveCycleStart - b.effectiveCycleStart);
}

/**
 * Hours or dollars allotted to one category for the billing cycle that starts
 * at `cycleStartMs`. With no saved change, the live retainer amount applies to
 * every cycle. After a change, earlier cycles keep the previous amount.
 */
export function allotmentForCycle(client, category, cycleStartMs) {
  const live = Number(client?.retainers?.[category] || 0);
  const rows = scheduleRows(client, category);
  const cycleStart = Number(cycleStartMs || 0);
  if (!rows.length || !cycleStart) return Number.isFinite(live) ? live : 0;

  let applicable = null;
  for (const row of rows) {
    if (row.effectiveCycleStart <= cycleStart) applicable = row;
    else break;
  }
  if (applicable) return applicable.amount;

  const baseline = client?.retainerAllotmentBaseline?.[category];
  if (baseline != null && baseline !== '' && Number.isFinite(Number(baseline))) {
    return Number(baseline);
  }
  return Number.isFinite(live) ? live : 0;
}

const AMOUNT_EPS = 0.001;

/**
 * Record a retainer edit so it starts at `nextCycleStart`.
 * Cycles that have already started keep the allotment already in effect.
 * `nextRetainers` is the amount the form is saving (what future cycles use).
 */
export function scheduleRetainerAllotmentChanges(
  prevClient,
  nextRetainers,
  { currentCycleStart, nextCycleStart } = {},
) {
  const baseline = { ...(prevClient?.retainerAllotmentBaseline || {}) };
  const schedule = {};
  for (const [cat, rows] of Object.entries(prevClient?.retainerAllotmentSchedule || {})) {
    const normalized = scheduleRows({ retainerAllotmentSchedule: { [cat]: rows } }, cat);
    if (normalized.length) schedule[cat] = normalized;
  }

  const currentStart = Number(currentCycleStart || 0);
  const nextStart = Number(nextCycleStart || 0);
  if (!prevClient || !currentStart || !nextStart || nextStart <= currentStart) {
    return {
      retainerAllotmentBaseline: baseline,
      retainerAllotmentSchedule: schedule,
    };
  }

  const cats = new Set([
    ...Object.keys(prevClient?.retainers || {}),
    ...Object.keys(nextRetainers || {}),
  ]);

  for (const cat of cats) {
    const prevSaved = Number(prevClient?.retainers?.[cat] ?? 0);
    const nextAmount = Number(nextRetainers?.[cat] ?? 0);
    if (!Number.isFinite(nextAmount) || !Number.isFinite(prevSaved)) continue;
    if (Math.abs(nextAmount - prevSaved) < AMOUNT_EPS) continue;

    const inEffectNow = allotmentForCycle(
      {
        ...prevClient,
        retainerAllotmentBaseline: baseline,
        retainerAllotmentSchedule: schedule,
      },
      cat,
      currentStart,
    );
    const hadAllotment =
      inEffectNow > AMOUNT_EPS ||
      prevSaved > AMOUNT_EPS ||
      (schedule[cat] || []).length > 0;
    if (!hadAllotment) continue;

    if (!Object.prototype.hasOwnProperty.call(baseline, cat)) {
      baseline[cat] = inEffectNow;
    }

    if (Math.abs(nextAmount - inEffectNow) < AMOUNT_EPS) {
      const locked = (schedule[cat] || []).filter(
        (row) => row.effectiveCycleStart <= currentStart,
      );
      if (locked.length) schedule[cat] = locked;
      else delete schedule[cat];
      continue;
    }

    const locked = (schedule[cat] || []).filter(
      (row) => row.effectiveCycleStart < nextStart,
    );
    schedule[cat] = [
      ...locked,
      { effectiveCycleStart: nextStart, amount: nextAmount },
    ];
  }

  return {
    retainerAllotmentBaseline: baseline,
    retainerAllotmentSchedule: schedule,
  };
}

export function getConfiguredRetainerCategoryNames(client) {
  return [
    ...new Set([
      ...Object.keys(client?.retainers || {}),
      ...Object.keys(client?.retainerCategoryEnabled || {}),
    ]),
  ];
}

export function getEnabledRetainerCategoryNames(client) {
  return getConfiguredRetainerCategoryNames(client).filter((cat) =>
    isRetainerCategoryEnabled(client, cat),
  );
}

export function getEnabledRetainerCategoryEntries(client) {
  return getEnabledRetainerCategoryNames(client).map((cat) => [
    cat,
    Number(client?.retainers?.[cat] ?? 0),
  ]);
}

export function clientHasEnabledRetainers(client) {
  return getEnabledRetainerCategoryNames(client).length > 0;
}

/** True when any enabled retainer category name mentions SEO (e.g. "SEO", "SEO/Web Development"). */
export function clientHasActiveSeoRetainer(client) {
  return getEnabledRetainerCategoryNames(client).some((name) =>
    String(name || '')
      .toLowerCase()
      .includes('seo'),
  );
}

/** Email Marketing (and similar) retainers. */
export function clientHasActiveEmailRetainer(client) {
  return getEnabledRetainerCategoryNames(client).some((name) =>
    String(name || '')
      .toLowerCase()
      .includes('email'),
  );
}

/**
 * Organic/social content retainers (e.g. "Social Media").
 * Excludes ad-budget lines so Ads gating stays separate.
 */
export function clientHasActiveSocialMediaRetainer(client) {
  return getEnabledRetainerCategoryNames(client).some((name) => {
    const lower = String(name || '').toLowerCase();
    return lower.includes('social media');
  });
}

/** Paid ads retainers (Social Ad Budget, PPC, Google Ads, etc.). */
export function clientHasActiveAdsRetainer(client) {
  return getEnabledRetainerCategoryNames(client).some((name) => {
    const lower = String(name || '').toLowerCase().trim();
    if (lower === 'social ad budget') return true;
    if (/\bgoogle\s*ads\b/.test(lower)) return true;
    if (/\bppc\b/.test(lower)) return true;
    if (/\bads?\b/.test(lower) && !lower.includes('social media')) return true;
    return false;
  });
}

/** Any Analytics hub sub-section retainer is active. */
export function clientHasActiveAnalyticsRetainer(client) {
  return (
    clientHasActiveSeoRetainer(client) ||
    clientHasActiveEmailRetainer(client) ||
    clientHasActiveSocialMediaRetainer(client) ||
    clientHasActiveAdsRetainer(client)
  );
}

export function isRetainerCategoryDollar(client, categoryName) {
  if (!categoryName) return false;
  return (
    categoryName === 'Social Ad Budget' ||
    client?.retainerUnits?.[categoryName] === 'dollar'
  );
}

export function normalizeRetainerCategoryEnabled(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === true || value === false) out[key] = value;
  }
  return out;
}

export function getRetainerCategoryNameFromKey(client, categoryKey, todoCategoryKeyFn) {
  if (!todoCategoryKeyFn) return null;
  for (const cat of Object.keys(client?.retainers || {})) {
    if (todoCategoryKeyFn(cat) === categoryKey) return cat;
  }
  return null;
}

export function isTodoCategoryKeyVisible(client, categoryKey, todoCategoryKeyFn) {
  const catName = getRetainerCategoryNameFromKey(client, categoryKey, todoCategoryKeyFn);
  // General, custom project, and legacy keys stay visible.
  if (!catName) return true;
  // Assigned/open work must remain visible even when a category is disabled for new budgets.
  if (categoryHasOpenTodos(client, categoryKey)) return true;
  return isRetainerCategoryEnabled(client, catName);
}

export function categoryHasOpenTodos(client, categoryKey) {
  const cycles = client?.todoCycles;
  if (!cycles || typeof cycles !== 'object') return false;
  for (const cycleData of Object.values(cycles)) {
    const catTodo = cycleData?.[categoryKey];
    if ((catTodo?.items || []).some((item) => !item?.done)) return true;
  }
  return false;
}

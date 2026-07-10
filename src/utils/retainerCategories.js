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

export function isRetainerCategoryEnabled(client, category) {
  if (!category) return false;
  const flags = client?.retainerCategoryEnabled;
  if (flags && typeof flags === 'object') {
    if (flags[category] === false) return false;
    if (flags[category] === true) return true;
  }
  const amount = Number(client?.retainers?.[category] ?? NaN);
  return Number.isFinite(amount) && amount > 0;
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

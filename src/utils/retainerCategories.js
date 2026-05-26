/**
 * Per-client retainer category enable/disable.
 * Explicit false hides a category everywhere; missing flag falls back to
 * enabled when allocation > 0 (legacy clients keep active categories visible).
 */

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

import { orderTodosForDisplay } from "./todoListOrder.js";
import { isClientActiveForWork } from "./clientActiveForWork.js";
import {
  getRetainerCategoryNameFromKey,
  isRetainerCategoryEnabled,
  isTodoCategoryKeyVisible,
} from "./retainerCategories.js";

/**
 * Build flat rows for all clients' current-cycle to-dos (same shape as AdminDashboard globalTodoRows).
 */
function buildLabelMap(c, projects, todoCategoryKey) {
  const keyOf = (category) =>
    String(category)
      .replace(/[~*[\]/]/g, "_")
      .replace(/\./g, "_");
  const labelMap = {};
  Object.keys(c.retainers || {}).forEach((cat) => {
    labelMap[keyOf(cat)] = cat;
  });
  for (const cycleData of Object.values(c.todoCycles || {})) {
    if (!cycleData || typeof cycleData !== 'object') continue;
    for (const catKey of Object.keys(cycleData)) {
      if (labelMap[catKey]) continue;
      const resolved = getRetainerCategoryNameFromKey(c, catKey, todoCategoryKey);
      labelMap[catKey] = resolved || catKey;
    }
  }
  labelMap[keyOf("General / Unclassified")] = "General / Unclassified";
  (projects || [])
    .filter((p) => p && p.clientId === c.id && !p.archived)
    .forEach((p) => {
      const catKey = todoCategoryKey
        ? todoCategoryKey(`project_${p.id}`)
        : `project_${p.id}`;
      labelMap[keyOf(catKey)] = p.title || "Custom Project";
    });
  return labelMap;
}

function rowsForClientCycle(c, cycleStart, todoState, projects, todoCategoryKey) {
  const labelMap = buildLabelMap(c, projects, todoCategoryKey);
  return Object.entries(todoState || {}).flatMap(([catKey, catTodo]) => {
    if (!isTodoCategoryKeyVisible(c, catKey, todoCategoryKey)) return [];
    const items = catTodo?.items || [];
    return orderTodosForDisplay(items).map((item) => ({
      clientId: c.id,
      clientName: c.name,
      cycleStart,
      categoryKey: catKey,
      categoryLabel: labelMap[catKey] || catKey,
      catTodo,
      item,
    }));
  });
}

export function buildGlobalTodoRows(
  clients,
  projects,
  getBillingPeriod,
  getTodoStateForCycle,
  todoCategoryKey,
  { allCycles = false } = {},
) {
  const list = (clients || []).filter(isClientActiveForWork);
  return list.flatMap((c) => {
    if (!allCycles) {
      const cycleStart = getBillingPeriod(c.billingDay || 1, 0).start;
      const todoState = getTodoStateForCycle ? getTodoStateForCycle(c, cycleStart) : {};
      return rowsForClientCycle(c, cycleStart, todoState, projects, todoCategoryKey);
    }

    const cycles = c.todoCycles || {};
    const cycleKeys = Object.keys(cycles);
    if (!cycleKeys.length) {
      const cycleStart = getBillingPeriod(c.billingDay || 1, 0).start;
      const todoState = getTodoStateForCycle ? getTodoStateForCycle(c, cycleStart) : {};
      return rowsForClientCycle(c, cycleStart, todoState, projects, todoCategoryKey);
    }

    return cycleKeys.flatMap((cycleKey) => {
      const cycleStart = Number(cycleKey);
      const todoState = cycles[cycleKey] || {};
      return rowsForClientCycle(c, cycleStart, todoState, projects, todoCategoryKey);
    }).concat(
      (() => {
        if (!getTodoStateForCycle) return [];
        const currentCycleStart = getBillingPeriod(c.billingDay || 1, 0).start;
        if (cycleKeys.includes(String(currentCycleStart))) return [];
        const todoState = getTodoStateForCycle(c, currentCycleStart);
        return rowsForClientCycle(
          c,
          currentCycleStart,
          todoState,
          projects,
          todoCategoryKey,
        );
      })(),
    );
  });
}

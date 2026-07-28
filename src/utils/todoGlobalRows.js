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

function dedupeTodoRowsAcrossCycles(rows) {
  const byKey = new Map();
  for (const row of rows || []) {
    const itemId = row?.item?.id;
    if (!itemId) continue;
    const key = `${row.clientId}__${row.categoryKey}__${itemId}`;
    const prev = byKey.get(key);
    if (!prev || Number(row.cycleStart) >= Number(prev.cycleStart)) {
      byKey.set(key, row);
    }
  }
  return dedupeOpenRecurringSeriesRows([...byKey.values()]);
}

/**
 * Keep only the earliest open occurrence of each recurring series in Due soon /
 * global task lists. Later-month seeds stay hidden until the earlier one is done.
 */
function dedupeOpenRecurringSeriesRows(rows) {
  const openBySeries = new Map();
  for (const row of rows || []) {
    const item = row?.item;
    if (!item?.recurring || item.done) continue;
    const rid = String(item.recurringId || item.id || '').trim();
    if (!rid) continue;
    const key = `${row.clientId}__${row.categoryKey}__${rid}`;
    if (!openBySeries.has(key)) openBySeries.set(key, []);
    openBySeries.get(key).push(row);
  }

  const drop = new Set();
  for (const [, group] of openBySeries) {
    if (group.length < 2) continue;
    group.sort((a, b) => {
      const ad = Number(a.item?.dueDate || 0);
      const bd = Number(b.item?.dueDate || 0);
      if (ad && bd && ad !== bd) return ad - bd;
      if (ad && !bd) return -1;
      if (!ad && bd) return 1;
      return Number(a.cycleStart || 0) - Number(b.cycleStart || 0);
    });
    for (let i = 1; i < group.length; i++) {
      drop.add(group[i]);
    }
  }
  if (!drop.size) return rows || [];
  return (rows || []).filter((row) => !drop.has(row));
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
      return dedupeTodoRowsAcrossCycles(
        rowsForClientCycle(c, cycleStart, todoState, projects, todoCategoryKey),
      );
    }

    const cycles = c.todoCycles || {};
    const cycleKeys = Object.keys(cycles);
    const currentCycleStart = getBillingPeriod(c.billingDay || 1, 0).start;

    if (!cycleKeys.length) {
      const todoState = getTodoStateForCycle ? getTodoStateForCycle(c, currentCycleStart) : {};
      return dedupeTodoRowsAcrossCycles(
        rowsForClientCycle(c, currentCycleStart, todoState, projects, todoCategoryKey),
      );
    }

    const cycleStartSet = new Set(cycleKeys.map((k) => Number(k)));
    cycleStartSet.add(currentCycleStart);

    const rows = [...cycleStartSet]
      .sort((a, b) => a - b)
      .flatMap((cycleStart) => {
        const todoState =
          cycleStart === currentCycleStart && getTodoStateForCycle
            ? getTodoStateForCycle(c, cycleStart)
            : cycles[String(cycleStart)] || {};
        return rowsForClientCycle(
          c,
          cycleStart,
          todoState,
          projects,
          todoCategoryKey,
        );
      });

    return dedupeTodoRowsAcrossCycles(rows);
  });
}

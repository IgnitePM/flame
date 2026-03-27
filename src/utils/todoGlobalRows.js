import { orderTodosForDisplay } from "./todoListOrder.js";

/**
 * Build flat rows for all clients' current-cycle to-dos (same shape as AdminDashboard globalTodoRows).
 */
export function buildGlobalTodoRows(
  clients,
  projects,
  getBillingPeriod,
  getTodoStateForCycle,
  todoCategoryKey,
) {
  const list = clients || [];
  return list.flatMap((c) => {
    const cycleStart = getBillingPeriod(c.billingDay || 1, 0).start;
    const todoState = getTodoStateForCycle ? getTodoStateForCycle(c, cycleStart) : {};
    const keyOf = (category) =>
      String(category)
        .replace(/[~*[\]/]/g, "_")
        .replace(/\./g, "_");
    const labelMap = {};
    Object.keys(c.retainers || {}).forEach((cat) => {
      labelMap[keyOf(cat)] = cat;
    });
    labelMap[keyOf("General / Unclassified")] = "General / Unclassified";
    (projects || [])
      .filter((p) => p && p.clientId === c.id && !p.archived)
      .forEach((p) => {
        const catKey = todoCategoryKey
          ? todoCategoryKey(`project_${p.id}`)
          : `project_${p.id}`;
        labelMap[keyOf(catKey)] = p.title || "Custom Project";
      });

    return Object.entries(todoState || {}).flatMap(([catKey, catTodo]) => {
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
  });
}

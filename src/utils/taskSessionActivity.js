import { getSubtasks } from './todoSubtasks.js';
import {
  getRetainerCategoryNameFromKey,
  isRetainerCategoryEnabled,
} from './retainerCategories.js';

export function resolveBillingCycleStartForTimestamp(
  client,
  timestampMs,
  getBillingPeriod,
) {
  if (!client || !getBillingPeriod || !timestampMs) return null;
  for (let offset = 0; offset >= -36; offset--) {
    const period = getBillingPeriod(client.billingDay || 1, offset);
    if (timestampMs >= period.start && timestampMs <= period.end) {
      return period.start;
    }
  }
  return getBillingPeriod(client.billingDay || 1, 0).start;
}

function taskSessionEndMs(task) {
  if (task?.status === 'active') return Date.now();
  const out = Number(task?.clockOutTime || 0);
  return out > 0 ? out : Number(task?.clockInTime || 0);
}

function matchesTaskTodoCategory(task, catKey, client, todoCategoryKey) {
  if (task.projectId) {
    if (!todoCategoryKey) return false;
    return catKey === todoCategoryKey(`project_${task.projectId}`);
  }
  const catName = String(task.projectName || '').trim();
  if (!catName) return false;
  if (todoCategoryKey && catKey === todoCategoryKey(catName)) return true;
  const resolved = getRetainerCategoryNameFromKey(client, catKey, todoCategoryKey);
  return resolved === catName;
}

/** Checklist items marked complete while a task log session was active. */
export function collectCompletedTodosDuringTaskSession({
  client,
  task,
  getTodoStateForCycle,
  getBillingPeriod,
  todoCategoryKey,
}) {
  if (!client || !task || !getTodoStateForCycle || !getBillingPeriod) return [];

  const startMs = Number(task.clockInTime || 0);
  const endMs = taskSessionEndMs(task);
  if (!startMs || endMs < startMs) return [];

  const cycleStart = resolveBillingCycleStartForTimestamp(
    client,
    startMs,
    getBillingPeriod,
  );
  if (cycleStart == null) return [];

  const todoState = getTodoStateForCycle(client, cycleStart) || {};
  const rows = [];

  for (const [catKey, catTodo] of Object.entries(todoState)) {
    if (!matchesTaskTodoCategory(task, catKey, client, todoCategoryKey)) continue;
    const catName = getRetainerCategoryNameFromKey(client, catKey, todoCategoryKey);
    if (catName && !isRetainerCategoryEnabled(client, catName)) continue;

    for (const item of catTodo?.items || []) {
      if (item?.done && item?.doneAt) {
        const doneAt = Number(item.doneAt);
        if (doneAt >= startMs && doneAt <= endMs) {
          rows.push({
            kind: 'todo',
            text: item.text || '(no text)',
            doneAt,
          });
        }
      }
      for (const sub of getSubtasks(item)) {
        if (sub?.done && sub?.doneAt) {
          const doneAt = Number(sub.doneAt);
          if (doneAt >= startMs && doneAt <= endMs) {
            rows.push({
              kind: 'subtask',
              text: sub.text || '(step)',
              parentText: item.text || '',
              doneAt,
            });
          }
        }
      }
    }
  }

  return rows.sort((a, b) => a.doneAt - b.doneAt);
}

export function findClientByName(clients, clientName) {
  return (clients || []).find((c) => c?.name === clientName) || null;
}

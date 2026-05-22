import { getSubtasks } from './todoSubtasks.js';
import {
  getRetainerCategoryNameFromKey,
  isRetainerCategoryEnabled,
} from './retainerCategories.js';

function buildCategoryLabelMap(client, projects, todoCategoryKey) {
  const map = {};
  Object.keys(client?.retainers || {}).forEach((cat) => {
    if (!isRetainerCategoryEnabled(client, cat)) return;
    map[cat.replace(/[~*[\]/]/g, '_').replace(/\./g, '_')] = cat;
  });
  map['General___Unclassified'] = 'General / Unclassified';
  (projects || [])
    .filter((p) => p && p.clientId === client?.id && !p.archived)
    .forEach((p) => {
      const key = todoCategoryKey ? todoCategoryKey(`project_${p.id}`) : `project_${p.id}`;
      map[key.replace(/[~*[\]/]/g, '_').replace(/\./g, '_')] = p.title || 'Custom Project';
    });
  return map;
}

export function collectCompletedTodosForCycle(
  client,
  cycleStart,
  getTodoStateForCycle,
  projects,
  todoCategoryKey,
) {
  if (!getTodoStateForCycle) return [];
  const todoState = getTodoStateForCycle(client, cycleStart) || {};
  const labelMap = buildCategoryLabelMap(client, projects, todoCategoryKey);
  const rows = [];

  for (const [catKey, catTodo] of Object.entries(todoState)) {
    const catName = getRetainerCategoryNameFromKey(
      client,
      catKey,
      todoCategoryKey,
    );
    if (catName && !isRetainerCategoryEnabled(client, catName)) continue;
    const categoryLabel = labelMap[catKey] || catKey;
    for (const item of catTodo?.items || []) {
      if (item?.done && item?.doneAt) {
        rows.push({
          kind: 'todo',
          text: item.text || '(no text)',
          doneAt: Number(item.doneAt),
          categoryLabel,
        });
      }
      for (const sub of getSubtasks(item)) {
        if (sub?.done && sub?.doneAt) {
          rows.push({
            kind: 'subtask',
            text: sub.text || '(step)',
            parentText: item.text || '',
            doneAt: Number(sub.doneAt),
            categoryLabel,
          });
        }
      }
    }
  }

  return rows.sort((a, b) => b.doneAt - a.doneAt);
}

export function collectCycleNotesForCycle(client, cycleStart, todoCategoryKey) {
  const raw = client?.cycleNotes?.[String(cycleStart)] || {};
  return Object.entries(raw)
    .filter(([catKey, text]) => {
      if (!String(text || '').trim()) return false;
      const catName = getRetainerCategoryNameFromKey(
        client,
        catKey,
        todoCategoryKey,
      );
      if (catName && !isRetainerCategoryEnabled(client, catName)) return false;
      return true;
    })
    .map(([catKey, text]) => ({
      catKey,
      text: String(text).trim(),
    }));
}

export function collectHourMovesForCycle(client, cycleStart) {
  const moves = client?.retainerHourMovesByCycle?.[String(cycleStart)] || [];
  return (Array.isArray(moves) ? moves : [])
    .filter(
      (m) =>
        isRetainerCategoryEnabled(client, m.from) &&
        isRetainerCategoryEnabled(client, m.to),
    )
    .map((m) => ({
    from: m.from,
    to: m.to,
    hours: Number(m.hours || 0),
    movedAt: Number(m.movedAt || 0),
    movedBy: m.movedBy || '',
  }));
}

/**
 * One-time migration planner: move open todos from legacy UTC-midnight billing
 * cycle keys (written by Netlify when getBillingPeriod used host-local Date)
 * onto the matching America/Toronto-midnight keys the CRM expects.
 *
 * Completed / rejected tasks stay put. Toronto-midnight keys are left alone.
 * Item ids, subtasks, comments, assignees, due dates, and recurrence are kept.
 */

import {
  isLegacyUtcBillingCycleKey,
  utcMidnightKeyToTorontoMidnightKey,
} from './billingEngine.js';

function cloneCycles(cycles) {
  return JSON.parse(JSON.stringify(cycles || {}));
}

function isOpenTodo(item) {
  return !!(item && !item.done && item.requestStatus !== 'rejected');
}

function summarizeItem(item) {
  const subtasks = Array.isArray(item.subtasks) ? item.subtasks : [];
  const comments = Array.isArray(item.comments) ? item.comments : [];
  return {
    id: item.id || null,
    text: String(item.text || '').trim().slice(0, 200),
    dueDate: item.dueDate ?? null,
    assigneeEmails: Array.isArray(item.assigneeEmails)
      ? item.assigneeEmails.filter(Boolean)
      : [],
    recurring: !!item.recurring,
    recurringId: item.recurringId || null,
    recurrence: item.recurrence || null,
    subtaskCount: subtasks.length,
    commentCount: comments.length,
    pinned: !!item.pinned,
  };
}

/**
 * Plan (and materialize) todoCycles patches for every client.
 * @returns {{
 *   moves: Array<object>,
 *   patches: Array<{ clientId: string, clientName: string, billingDay: number, todoCycles: object, moveCount: number }>,
 *   skippedCompleted: number,
 *   skippedNonLegacyCycleKeys: number,
 * }}
 */
export function planUtcTodoCycleKeyMigration(clients = []) {
  const moves = [];
  const patches = [];
  let skippedCompleted = 0;
  let skippedNonLegacyCycleKeys = 0;

  for (const client of clients || []) {
    if (!client?.id) continue;
    const billingDay = Number(client.billingDay) || 1;
    const cycles = client.todoCycles;
    if (!cycles || typeof cycles !== 'object') continue;

    let next = null;
    let moveCount = 0;

    for (const [fromKey, cycleData] of Object.entries(cycles)) {
      if (!isLegacyUtcBillingCycleKey(fromKey, billingDay)) {
        skippedNonLegacyCycleKeys += 1;
        continue;
      }
      const toMs = utcMidnightKeyToTorontoMidnightKey(fromKey);
      if (toMs == null) continue;
      const toKey = String(toMs);
      if (toKey === String(fromKey)) continue;
      if (!cycleData || typeof cycleData !== 'object') continue;

      for (const [categoryKey, cat] of Object.entries(cycleData)) {
        const items = Array.isArray(cat?.items) ? cat.items : [];
        const openItems = items.filter(isOpenTodo);
        skippedCompleted += items.length - openItems.length;
        if (!openItems.length) continue;

        if (!next) next = cloneCycles(cycles);

        const srcCycle = { ...(next[fromKey] || {}) };
        const srcCat = { ...(srcCycle[categoryKey] || { closed: false, items: [] }) };
        // Leave completed/rejected on the UTC key; strip only open items.
        srcCat.items = (Array.isArray(srcCat.items) ? srcCat.items : []).filter(
          (it) => !isOpenTodo(it),
        );
        srcCycle[categoryKey] = srcCat;
        next[fromKey] = srcCycle;

        const destCycle = { ...(next[toKey] || {}) };
        const destCat = {
          ...(destCycle[categoryKey] || { closed: false, items: [] }),
        };
        const destItems = Array.isArray(destCat.items) ? [...destCat.items] : [];
        const existingIds = new Set(
          destItems.map((it) => it?.id).filter((id) => id != null && id !== ''),
        );

        for (const item of openItems) {
          const alreadyPresent =
            item.id != null && item.id !== '' && existingIds.has(item.id);
          if (!alreadyPresent) {
            destItems.push(JSON.parse(JSON.stringify(item)));
            if (item.id != null && item.id !== '') existingIds.add(item.id);
          }
          moves.push({
            clientId: client.id,
            clientName: client.name || '',
            billingDay,
            categoryKey,
            fromCycleStart: Number(fromKey),
            toCycleStart: Number(toKey),
            fromIso: new Date(Number(fromKey)).toISOString(),
            toIso: new Date(Number(toKey)).toISOString(),
            alreadyPresent,
            ...summarizeItem(item),
          });
          moveCount += 1;
        }

        destCat.items = destItems;
        destCycle[categoryKey] = destCat;
        next[toKey] = destCycle;
      }
    }

    if (next && moveCount > 0) {
      patches.push({
        clientId: client.id,
        clientName: client.name || '',
        billingDay,
        todoCycles: next,
        moveCount,
      });
    }
  }

  return {
    moves,
    patches,
    skippedCompleted,
    skippedNonLegacyCycleKeys,
  };
}

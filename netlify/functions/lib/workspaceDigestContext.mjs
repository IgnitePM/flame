/**
 * Server-side equivalent of the kiosk "AI brief" context builder, for the
 * scheduled email digests. Reuses the same pure utils the client uses
 * (src/utils/*) so the digest matches what staff see in-app — only the
 * data-fetching (Firestore Admin here vs. onSnapshot in App.jsx) differs.
 *
 * `getTodoStateForCycle` and `getShiftDuration` below are ports of the
 * identically-named functions in src/App.jsx (they live inline there because
 * they close over live component state, not because the logic is React-y).
 * Keep them in sync if the source logic changes.
 */

import {
  GENERAL_LABEL,
  computeGlobalRetainerStats,
  getBillingPeriod,
  getTaskDuration,
} from '../../../src/utils/billingEngine.js';
import { getEnabledRetainerCategoryNames } from '../../../src/utils/retainerCategories.js';
import {
  materializeCycleTodoFromPrev,
  mergeOpenItemsFromPrevCycle,
} from '../../../src/utils/recurringTodoMaterialize.js';
import { buildAiSummaryPayload } from '../../../src/utils/aiSummaryPayload.js';

const newTodoId = () => `todo_${Date.now()}_${Math.random().toString(36).slice(2)}`;

export function todoCategoryKey(cat) {
  return String(cat ?? '').replace(/[~*[\]/]/g, '_').replace(/\./g, '_');
}

function buildVirtualCycleTodoData(client, cycleStart, prevData) {
  const categoryKeys = new Set([
    ...getEnabledRetainerCategoryNames(client).map((cat) => todoCategoryKey(cat)),
    todoCategoryKey(GENERAL_LABEL),
    ...Object.keys(prevData),
  ]);
  const { cycleData } = materializeCycleTodoFromPrev(
    {},
    prevData,
    cycleStart,
    newTodoId,
    Array.from(categoryKeys),
  );
  return cycleData;
}

export function getTodoStateForCycle(client, cycleStart) {
  const cycles = client.todoCycles || {};
  const currentCycleStart = getBillingPeriod(client.billingDay || 1, 0).start;
  const existing = cycles[String(cycleStart)];
  if (existing) {
    if (cycleStart !== currentCycleStart) return existing;
    const prevStart = getBillingPeriod(client.billingDay || 1, -1).start;
    const prevData = cycles[String(prevStart)] || {};
    const merged = mergeOpenItemsFromPrevCycle(existing, prevData);
    const { cycleData } = materializeCycleTodoFromPrev(merged, prevData, cycleStart, newTodoId);
    return cycleData;
  }
  if (cycleStart !== currentCycleStart) return {};
  const prevStart = getBillingPeriod(client.billingDay || 1, -1).start;
  const prevData = cycles[String(prevStart)] || {};
  return buildVirtualCycleTodoData(client, cycleStart, prevData);
}

export function getShiftDuration(shift) {
  if (shift.status === 'active') {
    return (
      (shift.totalSavedDuration || 0) + (Date.now() - (shift.lastResumeTime || shift.clockInTime))
    );
  }
  if (shift.status === 'break') return shift.totalSavedDuration || 0;
  if (shift.status === 'completed') {
    return Number(shift.duration ?? shift.totalSavedDuration ?? 0);
  }
  const cin = Number(shift.clockInTime || 0);
  const out = Number(shift.clockOutTime || 0);
  if (out > cin) {
    return Number(shift.duration ?? shift.totalSavedDuration ?? 0);
  }
  return (
    (shift.totalSavedDuration || 0) + (Date.now() - (shift.lastResumeTime || shift.clockInTime))
  );
}

/**
 * Builds the same shape of payload as the kiosk's "overall" AI brief,
 * scoped as a full super-admin workspace view (the digest is a shared
 * staff briefing, not a per-recipient personalized one).
 */
export function buildWorkspaceDigestPayload({ clients, timesheets, taskLogs, expenses, addons }) {
  const liveShiftIds = new Set(
    (timesheets || [])
      .filter((s) => s && (s.status === 'active' || s.status === 'break'))
      .map((s) => s.id),
  );
  const getTaskDurationForBilling = (task) => getTaskDuration(task, { liveShiftIds });
  const getGlobalRetainerStats = (client, start, end) =>
    computeGlobalRetainerStats(client, start, end, { taskLogs, expenses, addons, timesheets });

  return buildAiSummaryPayload({
    scope: 'overall',
    clients,
    getTodoStateForCycle,
    getBillingPeriod,
    getGlobalRetainerStats,
    timesheets,
    taskLogs,
    getShiftDuration,
    getTaskDuration: getTaskDurationForBilling,
    user: { email: 'workspace-digest@ignitepm.com' },
    role: 'admin',
  });
}

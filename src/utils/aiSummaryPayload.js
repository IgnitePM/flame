import { getEnabledRetainerCategoryNames } from './retainerCategories.js';
import { getTaskComments } from './taskComments.js';
import { isSuperAdminUser, normalizeStaffEmail } from './staffDirectory.js';

function dueLabel(ms) {
  const n = Number(ms || 0);
  if (!n) return null;
  return new Date(n).toLocaleDateString();
}

function compactTodos(clients, getTodoStateForCycle, getBillingPeriod, clientId = null) {
  const rows = [];
  for (const client of clients || []) {
    if (clientId && client.id !== clientId) continue;
    const period = getBillingPeriod(client.billingDay || 1, 0);
    const state = getTodoStateForCycle?.(client, period.start) || {};
    for (const [catKey, cat] of Object.entries(state)) {
      for (const item of cat?.items || []) {
        if (!item) continue;
        const comments = getTaskComments(item).slice(-4).map((c) => ({
          author: c.authorName || c.authorEmail,
          text: c.text,
          at: c.createdAt,
        }));
        rows.push({
          client: client.name,
          category: catKey,
          text: item.text,
          done: !!item.done,
          due: dueLabel(item.dueDate),
          assignees: item.assigneeEmails || [],
          comments,
        });
      }
    }
  }
  return rows.slice(0, 80);
}

function compactRetainers(clients, getGlobalRetainerStats, getBillingPeriod, clientId = null) {
  const rows = [];
  for (const client of clients || []) {
    if (clientId && client.id !== clientId) continue;
    const period = getBillingPeriod(client.billingDay || 1, 0);
    let stats = null;
    try {
      stats = getGlobalRetainerStats(client, period.start, period.end);
    } catch {
      continue;
    }
    for (const cat of getEnabledRetainerCategoryNames(client)) {
      const pc = stats?.perCategory?.[cat];
      if (!pc) continue;
      const allotted = Number(pc.adjustedAllotted || 0);
      const used = Number(pc.used || 0);
      const remaining = allotted - used;
      const daysLeft = Math.max(
        0,
        Math.ceil((period.end - Date.now()) / 86400000),
      );
      rows.push({
        client: client.name,
        category: cat,
        allotted: Number(allotted.toFixed(2)),
        used: Number(used.toFixed(2)),
        remaining: Number(remaining.toFixed(2)),
        over: allotted > 0 ? used > allotted + 0.03 : used > 0.03,
        daysLeft,
      });
    }
  }
  return rows;
}

function hoursOf(ms) {
  return Number(ms || 0) / 3600000;
}

function compactTimesheets({
  timesheets,
  taskLogs,
  getShiftDuration,
  getTaskDuration,
  user,
  role,
}) {
  const superAdmin = isSuperAdminUser(user, role);
  const me = normalizeStaffEmail(user?.email);
  const cutoff = Date.now() - 14 * 86400000;
  const shifts = (timesheets || []).filter((s) => {
    if (Number(s.clockInTime || 0) < cutoff) return false;
    if (superAdmin) return true;
    return String(s.userId || '') === String(user?.uid || '') ||
      normalizeStaffEmail(s.employeeName) === me ||
      normalizeStaffEmail(s.userEmail) === me;
  });

  return shifts.slice(0, 40).map((shift) => {
    const tasks = (taskLogs || []).filter((t) => t.shiftId === shift.id);
    const hours = hoursOf(
      typeof getShiftDuration === 'function' ? getShiftDuration(shift) : shift.duration,
    );
    return {
      employee: shift.employeeName || shift.userId,
      date: new Date(shift.clockInTime).toLocaleDateString(),
      hours: Number(hours.toFixed(2)),
      status: shift.status,
      autoStopped: shift.autoStoppedReason === 'idle_timeout',
      stillOpen: shift.status === 'active' || shift.status === 'break',
      tasks: tasks.slice(0, 8).map((t) => ({
        client: t.clientName,
        category: t.projectName,
        hours: Number(
          hoursOf(typeof getTaskDuration === 'function' ? getTaskDuration(t) : t.duration).toFixed(2),
        ),
      })),
    };
  });
}

export function buildAiSummaryPayload({
  scope = 'overall',
  clientId = null,
  clients = [],
  getTodoStateForCycle,
  getBillingPeriod,
  getGlobalRetainerStats,
  timesheets = [],
  taskLogs = [],
  getShiftDuration,
  getTaskDuration,
  user,
  role,
}) {
  const scopedClients = clientId
    ? (clients || []).filter((c) => c.id === clientId)
    : clients || [];
  return {
    scope,
    generatedAt: new Date().toISOString(),
    viewer: {
      email: normalizeStaffEmail(user?.email),
      role: role || 'kiosk',
      superAdmin: isSuperAdminUser(user, role),
    },
    todos: compactTodos(
      scopedClients,
      getTodoStateForCycle,
      getBillingPeriod,
      clientId,
    ),
    retainers: compactRetainers(
      scopedClients,
      getGlobalRetainerStats,
      getBillingPeriod,
      clientId,
    ),
    timesheets: compactTimesheets({
      timesheets,
      taskLogs,
      getShiftDuration,
      getTaskDuration,
      user,
      role,
    }),
  };
}

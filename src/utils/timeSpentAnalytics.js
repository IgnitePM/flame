/**
 * Aggregate taskLog hours for ops analytics (clients, retainers, projects).
 * Hours are prorated into [rangeStart, rangeEnd] when a block spans the edges.
 */

import {
  GENERAL_LABEL,
  getLiveShiftIdSet,
  getTaskDuration,
} from './billingEngine.js';

function timelineEndMs(task, now = Date.now()) {
  const out = Number(task?.clockOutTime || 0);
  if (out > 0) return out;
  if (task?.status === 'active' || task?.status === 'break') return now;
  const cin = Number(task?.clockInTime || 0);
  const dur = Number(task?.duration ?? task?.totalSavedDuration ?? 0);
  if (cin && dur > 0) return cin + dur;
  return cin || now;
}

/** Hours of this task attributed to [rangeStart, rangeEnd]. */
export function hoursOfTaskInRange(task, rangeStart, rangeEnd, durationMs) {
  const totalMs = Number(durationMs);
  if (!Number.isFinite(totalMs) || totalMs <= 0) return 0;
  const start = Number(task?.clockInTime || 0);
  if (!start) return 0;
  const end = timelineEndMs(task);
  const span = end - start;
  if (span <= 0) return 0;
  const overlapStart = Math.max(start, rangeStart);
  const overlapEnd = Math.min(end, rangeEnd);
  if (overlapEnd <= overlapStart) return 0;
  return (totalMs * (overlapEnd - overlapStart)) / span / 3600000;
}

function taskOverlapsRange(task, rangeStart, rangeEnd) {
  const start = Number(task?.clockInTime || 0);
  if (!start) return false;
  const end = timelineEndMs(task);
  return start <= rangeEnd && end >= rangeStart;
}

function bump(map, key, hours, extra = {}) {
  if (!key || !Number.isFinite(hours) || hours <= 0) return;
  const prev = map.get(key) || { key, hours: 0, ...extra };
  prev.hours += hours;
  Object.assign(prev, extra);
  map.set(key, prev);
}

function sortRows(map) {
  return [...map.values()].sort((a, b) => b.hours - a.hours);
}

/**
 * @returns {{
 *   totalHours: number,
 *   byKind: Array<{ key: string, label: string, hours: number }>,
 *   byClient: Array<{ key: string, label: string, hours: number }>,
 *   byCategory: Array<{ key: string, label: string, hours: number }>,
 *   byProject: Array<{ key: string, label: string, hours: number, clientLabel?: string }>,
 *   byStaff: Array<{ key: string, label: string, hours: number }>,
 * }}
 */
export function aggregateTimeSpent({
  taskLogs = [],
  projects = [],
  clients = [],
  timesheets = [],
  rangeStart,
  rangeEnd,
  clientId = '',
  staffKey = '',
  now = Date.now(),
} = {}) {
  const liveShiftIds = getLiveShiftIdSet(timesheets);
  const clientNameById = new Map(
    (clients || []).map((c) => [c.id, c.name || c.id]),
  );
  const projectById = new Map((projects || []).map((p) => [p.id, p]));
  const shiftById = new Map((timesheets || []).map((s) => [s.id, s]));

  const byKind = new Map();
  const byClient = new Map();
  const byCategory = new Map();
  const byProject = new Map();
  const byStaff = new Map();
  let totalHours = 0;

  const wantClient = String(clientId || '').trim();
  const wantStaff = String(staffKey || '').trim().toLowerCase();

  for (const task of taskLogs || []) {
    if (!taskOverlapsRange(task, rangeStart, rangeEnd)) continue;

    const cid = String(task.clientId || '').trim();
    const cname = String(task.clientName || '').trim();
    if (wantClient) {
      const matchId = cid === wantClient;
      const matchName =
        !cid &&
        cname &&
        clientNameById.get(wantClient) &&
        cname === clientNameById.get(wantClient);
      if (!matchId && !matchName) continue;
    }

    const shift = task.shiftId ? shiftById.get(task.shiftId) : null;
    const staffId = String(
      task.userId || shift?.userId || '',
    ).trim();
    const staffName = String(
      task.employeeName || shift?.employeeName || '',
    ).trim();
    const staffKeyResolved = (staffId || staffName || 'unknown').toLowerCase();
    if (wantStaff && staffKeyResolved !== wantStaff) continue;

    const durationMs = getTaskDuration(task, { liveShiftIds });
    const hours = hoursOfTaskInRange(task, rangeStart, rangeEnd, durationMs);
    if (hours <= 0) continue;

    totalHours += hours;

    const clientLabel =
      (cid && clientNameById.get(cid)) || cname || 'Unknown client';
    bump(byClient, cid || cname || 'unknown', hours, { label: clientLabel });

    bump(byStaff, staffKeyResolved, hours, {
      label: staffName || staffId || 'Unknown',
    });

    if (task.projectId) {
      const project = projectById.get(task.projectId);
      const projectLabel =
        project?.title ||
        task.projectName ||
        'Custom project';
      bump(byKind, 'project', hours, { label: 'Custom projects' });
      bump(byProject, task.projectId, hours, {
        label: projectLabel,
        clientLabel,
      });
    } else {
      const cat = String(task.projectName || '').trim();
      if (!cat || cat === GENERAL_LABEL) {
        bump(byKind, 'general', hours, { label: GENERAL_LABEL });
        bump(byCategory, GENERAL_LABEL, hours, { label: GENERAL_LABEL });
      } else {
        bump(byKind, 'retainer', hours, { label: 'Retainer categories' });
        bump(byCategory, cat, hours, { label: cat });
      }
    }
  }

  // Ensure kind rows always present for stable chart order
  const kindOrder = [
    { key: 'retainer', label: 'Retainer categories' },
    { key: 'project', label: 'Custom projects' },
    { key: 'general', label: GENERAL_LABEL },
  ];
  for (const k of kindOrder) {
    if (!byKind.has(k.key)) byKind.set(k.key, { key: k.key, label: k.label, hours: 0 });
  }

  return {
    totalHours,
    byKind: kindOrder
      .map((k) => byKind.get(k.key))
      .filter(Boolean)
      .concat(
        [...byKind.values()].filter(
          (r) => !kindOrder.some((k) => k.key === r.key),
        ),
      ),
    byClient: sortRows(byClient),
    byCategory: sortRows(byCategory),
    byProject: sortRows(byProject),
    byStaff: sortRows(byStaff),
  };
}

export function startOfLocalDay(ms = Date.now()) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfLocalDay(ms = Date.now()) {
  const d = new Date(ms);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/** Preset ranges for the Time spent view. */
export function getTimeSpentRange(preset, customStart = '', customEnd = '', now = Date.now()) {
  const todayStart = startOfLocalDay(now);
  if (preset === 'day') {
    return { start: todayStart, end: endOfLocalDay(now) };
  }
  if (preset === 'week') {
    const d = new Date(todayStart);
    const day = d.getDay(); // 0 Sun
    const mondayOffset = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + mondayOffset);
    return { start: d.getTime(), end: endOfLocalDay(now) };
  }
  if (preset === 'month') {
    const d = new Date(now);
    const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    return { start, end: endOfLocalDay(now) };
  }
  if (preset === '90d') {
    return { start: todayStart - 89 * 24 * 60 * 60 * 1000, end: endOfLocalDay(now) };
  }
  if (preset === 'custom' && customStart && customEnd) {
    const start = startOfLocalDay(new Date(`${customStart}T00:00:00`).getTime());
    const end = endOfLocalDay(new Date(`${customEnd}T00:00:00`).getTime());
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      return { start, end };
    }
  }
  // default: this month
  const d = new Date(now);
  return {
    start: new Date(d.getFullYear(), d.getMonth(), 1).getTime(),
    end: endOfLocalDay(now),
  };
}

export function formatHoursDecimal(hours) {
  const n = Number(hours) || 0;
  if (n < 0.05) return '0';
  return n.toFixed(n >= 10 ? 1 : 2);
}

export function formatHoursHm(hours) {
  const totalMins = Math.round((Number(hours) || 0) * 60);
  const h = Math.floor(totalMins / 60);
  const m = Math.abs(totalMins % 60);
  return `${h}h ${m}m`;
}

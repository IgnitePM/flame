/**
 * Shift ↔ task association helpers.
 *
 * Tasks belong to shifts via task.shiftId (foreign key). Do not filter
 * FK-linked tasks by time containment — that silently drops billable work.
 */

/** @param {Array<{ shiftId?: string }>} taskLogs @param {string} shiftId */
export function getTasksForShift(taskLogs, shiftId) {
  if (!shiftId) return [];
  return (taskLogs || []).filter((t) => t.shiftId === shiftId);
}

/**
 * Tasks with missing shiftId, or shiftId pointing at a shift that does not exist.
 * @param {Array<{ shiftId?: string }>} taskLogs
 * @param {Array<{ id: string }>} timesheets
 */
export function getUnassignedTasks(taskLogs, timesheets) {
  const shiftIds = new Set((timesheets || []).map((s) => s.id).filter(Boolean));
  return (taskLogs || []).filter((t) => {
    const sid = t?.shiftId;
    return !sid || !shiftIds.has(sid);
  });
}

/** @param {{ clockInTime?: number, clockOutTime?: number }} shift @param {number} [now] */
export function getStoredShiftWindow(shift, now = Date.now()) {
  const start = Number(shift?.clockInTime || 0);
  const end = Number(shift?.clockOutTime || 0) || now;
  return { start, end };
}

/**
 * Display window derived from child tasks (min clock-in → max clock-out).
 * @param {Array<{ clockInTime?: number, clockOutTime?: number }>} tasks
 * @param {number} [now]
 */
export function getDerivedShiftWindow(tasks, now = Date.now()) {
  if (!tasks?.length) return null;
  let minIn = Infinity;
  let maxOut = -Infinity;
  for (const t of tasks) {
    const cin = Number(t.clockInTime || 0);
    const cout = Number(t.clockOutTime || 0) || (cin ? now : 0);
    if (cin > 0 && cin < minIn) minIn = cin;
    if (cout > 0 && cout > maxOut) maxOut = cout;
  }
  if (!Number.isFinite(minIn) || !Number.isFinite(maxOut) || minIn === Infinity) {
    return null;
  }
  return { start: minIn, end: maxOut };
}

/**
 * True when the task interval extends outside the *stored* shift window.
 * (Derived window cannot contradict its own tasks by definition.)
 */
export function isTaskOutsideShiftWindow(task, shift, now = Date.now()) {
  const { start, end } = getStoredShiftWindow(shift, now);
  if (!start) return false;
  const cin = Number(task?.clockInTime || 0);
  const cout = Number(task?.clockOutTime || 0) || now;
  if (!cin) return false;
  return cin < start || cout > end;
}

/** Human-readable reason for the out-of-window badge. */
export function describeTaskOutsideWindow(task, shift, now = Date.now()) {
  const { start, end } = getStoredShiftWindow(shift, now);
  const cin = Number(task?.clockInTime || 0);
  const cout = Number(task?.clockOutTime || 0) || now;
  const parts = [];
  if (cin && cin < start) {
    const sec = Math.round((start - cin) / 1000);
    parts.push(`starts ${sec}s before shift`);
  }
  if (cout && cout > end) {
    const sec = Math.round((cout - end) / 1000);
    parts.push(`ends ${sec}s after shift`);
  }
  return parts.join('; ') || 'outside shift window';
}

function sameEmployee(task, shift) {
  if (task?.userId && shift?.userId && task.userId === shift.userId) return true;
  const tn = String(task?.employeeName || '').trim().toLowerCase();
  const sn = String(shift?.employeeName || '').trim().toLowerCase();
  if (tn && sn && tn === sn) return true;
  return false;
}

/**
 * Legacy time-containment check (clock-out inside shift window).
 * Used only for migration backfill, not for display filtering.
 */
export function taskClockOutContainedInShift(task, shift, now = Date.now()) {
  if (!sameEmployee(task, shift)) return false;
  const { start, end } = getStoredShiftWindow(shift, now);
  const cout = Number(task?.clockOutTime || 0);
  if (!cout || !start) return false;
  return cout >= start && cout <= end;
}

/** True if task interval overlaps the stored shift window at all. */
export function taskOverlapsShiftWindow(task, shift, now = Date.now()) {
  if (!sameEmployee(task, shift)) return false;
  const { start, end } = getStoredShiftWindow(shift, now);
  const cin = Number(task?.clockInTime || 0);
  const cout = Number(task?.clockOutTime || 0) || now;
  if (!cin || !start) return false;
  return cin < end && cout > start;
}

/**
 * Pick the best parent shift for a task during backfill.
 * Order: existing valid shiftId → clock-out containment → overlap → nearest by clock-in.
 *
 * @returns {{ shiftId: string|null, method: string, candidates: number }}
 */
export function resolveShiftIdForTask(task, timesheets, now = Date.now()) {
  const shifts = timesheets || [];
  const byId = new Map(shifts.map((s) => [s.id, s]));

  if (task?.shiftId && byId.has(task.shiftId)) {
    return { shiftId: task.shiftId, method: 'existing', candidates: 1 };
  }

  const eligible = shifts.filter((s) => sameEmployee(task, s));
  if (eligible.length === 0) {
    return { shiftId: null, method: 'none', candidates: 0 };
  }

  const contained = eligible.filter((s) =>
    taskClockOutContainedInShift(task, s, now),
  );
  if (contained.length === 1) {
    return { shiftId: contained[0].id, method: 'clock_out_containment', candidates: 1 };
  }
  if (contained.length > 1) {
    const nearest = pickNearestByClockIn(task, contained);
    return {
      shiftId: nearest.id,
      method: 'clock_out_containment_nearest',
      candidates: contained.length,
    };
  }

  const overlapping = eligible.filter((s) => taskOverlapsShiftWindow(task, s, now));
  if (overlapping.length === 1) {
    return { shiftId: overlapping[0].id, method: 'overlap', candidates: 1 };
  }
  if (overlapping.length > 1) {
    const nearest = pickNearestByClockIn(task, overlapping);
    return {
      shiftId: nearest.id,
      method: 'overlap_nearest',
      candidates: overlapping.length,
    };
  }

  const nearest = pickNearestByClockIn(task, eligible);
  return {
    shiftId: nearest?.id || null,
    method: nearest ? 'nearest_shift' : 'none',
    candidates: eligible.length,
  };
}

function pickNearestByClockIn(task, shifts) {
  const cin = Number(task?.clockInTime || 0);
  if (!cin || !shifts?.length) return shifts?.[0] || null;
  let best = null;
  let bestDist = Infinity;
  for (const s of shifts) {
    const dist = Math.abs(Number(s.clockInTime || 0) - cin);
    if (dist < bestDist) {
      bestDist = dist;
      best = s;
    }
  }
  return best;
}

/**
 * Build a dry-run / apply plan for backfilling task.shiftId.
 * Does not write. Only proposes changes when resolved shiftId differs from current.
 *
 * @returns {Array<{ taskId: string, from: string|null, to: string, method: string, candidates: number }>}
 */
export function planShiftIdBackfill(taskLogs, timesheets, now = Date.now()) {
  const plan = [];
  for (const task of taskLogs || []) {
    if (!task?.id) continue;
    const resolved = resolveShiftIdForTask(task, timesheets, now);
    if (!resolved.shiftId) continue;
    if (task.shiftId === resolved.shiftId) continue;
    plan.push({
      taskId: task.id,
      from: task.shiftId || null,
      to: resolved.shiftId,
      method: resolved.method,
      candidates: resolved.candidates,
      clockInTime: task.clockInTime,
      clockOutTime: task.clockOutTime,
      employeeName: task.employeeName || null,
      clientName: task.clientName || null,
    });
  }
  return plan;
}

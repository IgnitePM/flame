/** Resolve who logged a task session from the parent shift record. */
export function getTaskEmployeeName(task, timesheets = []) {
  if (task?.employeeName) return String(task.employeeName);
  const shift = (timesheets || []).find((s) => s.id === task?.shiftId);
  return shift?.employeeName || 'Unknown';
}

export function getTaskDurationHours(task, getTaskDuration) {
  if (typeof getTaskDuration !== 'function' || !task) return 0;
  const ms = Number(getTaskDuration(task) || 0);
  return Math.max(0, ms / 3600000);
}

export function formatDecimalHours(hours) {
  return Number(hours || 0).toFixed(2);
}

/** @typedef {"open" | "completed"} TodoStatusFilter */
/** @typedef {"next7" | "next14" | "next30" | "all_future"} TodoDueWindowFilter */

export function startOfTodayMs(now = Date.now()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addDaysMs(ms, days) {
  return ms + days * 86400000;
}

export function taskMatchesStatus(item, statusFilter) {
  if (statusFilter === "open") return !item?.done;
  if (statusFilter === "completed") return !!item?.done;
  return true;
}

export function taskMatchesDueWindow(item, dueFilter, now = Date.now()) {
  const due = Number(item?.dueDate || 0);
  const t0 = startOfTodayMs(now);
  if (!due) return true;
  if (dueFilter === "all_future") return due >= t0;
  if (due < t0) return true;
  const end =
    dueFilter === "next7"
      ? addDaysMs(t0, 7)
      : dueFilter === "next14"
        ? addDaysMs(t0, 14)
        : addDaysMs(t0, 30);
  return due < end;
}

export function todoRowMatchesFilters(row, statusFilter, dueFilter, now = Date.now()) {
  return (
    taskMatchesStatus(row.item, statusFilter) &&
    taskMatchesDueWindow(row.item, dueFilter, now)
  );
}

function compareTodoRowsByDueThenClient(a, b, t0) {
  const ad = Number(a.item?.dueDate || 0);
  const bd = Number(b.item?.dueDate || 0);
  const aOver = ad > 0 && ad < t0;
  const bOver = bd > 0 && bd < t0;
  if (aOver !== bOver) return aOver ? -1 : 1;
  if (ad && bd) return ad - bd;
  if (ad && !bd) return -1;
  if (!ad && bd) return 1;
  return String(a.clientName || "").localeCompare(String(b.clientName || ""));
}

export function sortTodoRowsByDueThenClient(rows) {
  const t0 = startOfTodayMs();
  return [...rows].sort((a, b) => compareTodoRowsByDueThenClient(a, b, t0));
}

/** Group by client name first, then due date (overdue first, etc.). */
export function sortTodoRowsByClientThenDue(rows) {
  const t0 = startOfTodayMs();
  return [...rows].sort((a, b) => {
    const c = String(a.clientName || '').localeCompare(String(b.clientName || ''));
    if (c !== 0) return c;
    return compareTodoRowsByDueThenClient(a, b, t0);
  });
}

export function buildKioskBillingTargetFromTodoRow(
  row,
  client,
  projects,
  todoCategoryKey,
  generalLabel,
) {
  const catKey = row.categoryKey;
  const gk = todoCategoryKey(generalLabel);
  if (String(catKey) === String(gk)) {
    return "retainer_GENERAL_UNCLASSIFIED";
  }
  const plist = projects || [];
  const proj = plist.find((p) => {
    if (!p || String(p.clientId || "") !== String(client?.id || "")) return false;
    const k = todoCategoryKey(`project_${p.id}`);
    return String(k) === String(catKey);
  });
  if (proj?.id) {
    return `project_${proj.id}`;
  }
  return `retainer_${row.categoryLabel}`;
}

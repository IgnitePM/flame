/** @param {unknown} e */
export function normalizeEmail(e) {
  return String(e || '').trim().toLowerCase();
}

/** @param {unknown} arr */
export function normalizeEmailList(arr) {
  if (!Array.isArray(arr)) return [];
  return [...new Set(arr.map(normalizeEmail).filter(Boolean))];
}

/**
 * Workspace / kiosk visibility for internal team (not client portal users).
 * - `teamMemberAccessEmails` missing: legacy open access for all staff who can read clients.
 * - Empty array: explicitly no workspace visibility for this client.
 * - Non-empty: only listed emails may see the client in Workspace / kiosk client lists.
 *
 * @param {{ teamMemberAccessEmails?: string[] } | null | undefined} client
 * @param {string | null | undefined} userEmail
 */
export function teamMemberCanViewClient(client, userEmail) {
  const me = normalizeEmail(userEmail);
  if (!me) return false;
  const raw = client?.teamMemberAccessEmails;
  if (raw == null) return true;
  if (!Array.isArray(raw)) return true;
  if (raw.length === 0) return false;
  return raw.map(normalizeEmail).includes(me);
}

/**
 * Walk Firestore `todoCycles` and collect normalized assignee emails (all billing cycles).
 * @param {Record<string, unknown> | undefined} todoCycles
 */
export function collectAssigneeEmailsFromTodoCycles(todoCycles) {
  const set = new Set();
  const cycles = todoCycles && typeof todoCycles === 'object' ? todoCycles : {};
  for (const cycleData of Object.values(cycles)) {
    if (!cycleData || typeof cycleData !== 'object') continue;
    for (const cat of Object.values(cycleData)) {
      const items = cat?.items;
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        const arr = item?.assigneeEmails;
        if (!Array.isArray(arr)) continue;
        for (const e of arr) {
          const n = normalizeEmail(e);
          if (n) set.add(n);
        }
      }
    }
  }
  return Array.from(set);
}

/**
 * When Workspace access is restricted (`teamMemberAccessEmails` is present), ensure
 * assignees on client to-dos can read the client (Firestore rules + kiosk client list).
 * Legacy (missing field): no-op — all staff already have kiosk read for that client.
 *
 * @returns {Partial<{ teamMemberAccessEmails: string[] }>} Firestore merge fields, or {}
 */
export function buildTeamAccessMergeForTodoAssignees(client, nextTodoCycles) {
  const assignees = collectAssigneeEmailsFromTodoCycles(nextTodoCycles);
  if (!assignees.length) return {};
  const raw = client?.teamMemberAccessEmails;
  if (raw == null) return {};
  const prev = normalizeEmailList(Array.isArray(raw) ? raw : []);
  const merged = normalizeEmailList([...prev, ...assignees]);
  if (merged.length === prev.length) return {};
  return { teamMemberAccessEmails: merged };
}

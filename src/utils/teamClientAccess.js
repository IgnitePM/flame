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
/** @param {Record<string, unknown> | null | undefined} item */
export function extractItemAssigneeEmails(item) {
  if (!item || typeof item !== 'object') return [];
  const fromArr = Array.isArray(item.assigneeEmails) ? item.assigneeEmails : [];
  const legacy = item.assigneeEmail ?? item.assignee ?? '';
  return normalizeEmailList([
    ...fromArr,
    ...(typeof legacy === 'string' ? [legacy] : []),
  ]);
}

export function teamMemberCanViewClient(client, userEmail) {
  const me = normalizeEmail(userEmail);
  if (!me) return false;
  // Assigned on any client to-do always grants workspace/kiosk visibility.
  const todoAssignees = collectAssigneeEmailsFromTodoCycles(client?.todoCycles);
  if (todoAssignees.includes(me)) return true;

  const raw = client?.teamMemberAccessEmails;
  if (raw == null) return true;
  // Malformed single-email string: honor it as a one-entry restriction
  // instead of silently granting everyone access.
  if (typeof raw === 'string') {
    return raw.trim() ? normalizeEmail(raw) === me : false;
  }
  if (!Array.isArray(raw)) return true;
  if (raw.length === 0) return false;
  return raw.map(normalizeEmail).includes(me);
}

/** Clients this team member may see in kiosk / workspace lists. */
export function filterClientsForTeamMember(clients, userEmail) {
  return (clients || []).filter((c) => c && teamMemberCanViewClient(c, userEmail));
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
        for (const e of extractItemAssigneeEmails(item)) {
          set.add(e);
        }
        const subs = item?.subtasks;
        if (!Array.isArray(subs)) continue;
        for (const sub of subs) {
          for (const e of extractItemAssigneeEmails(sub)) {
            set.add(e);
          }
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

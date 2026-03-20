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

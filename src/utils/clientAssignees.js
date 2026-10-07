/** Portal login emails on one client profile. */

export function normalizeAssigneeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function portalUserEmailsForClient(client) {
  const raw = Array.isArray(client?.clientEmails) ? client.clientEmails : [];
  return [
    ...new Set(raw.map(normalizeAssigneeEmail).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b));
}

/**
 * Staff stay in the staff group. Portal users from this client only appear
 * under the client group, and only when `client` is provided.
 * Selected emails that are no longer on either list stay visible so they can be cleared.
 */
export function assigneeChoiceGroups({
  staffEmails = [],
  client = null,
  selected = [],
} = {}) {
  const staff = [
    ...new Set((staffEmails || []).map(normalizeAssigneeEmail).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b));
  const staffSet = new Set(staff);
  const showClients = Boolean(client && typeof client === 'object');
  const clients = showClients
    ? portalUserEmailsForClient(client).filter((email) => !staffSet.has(email))
    : [];
  const known = new Set([...staff, ...clients]);
  const other = [
    ...new Set(
      (selected || [])
        .map(normalizeAssigneeEmail)
        .filter((email) => email && !known.has(email)),
    ),
  ].sort((a, b) => a.localeCompare(b));
  return { staff, clients, other, showClients };
}

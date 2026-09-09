/** Portal login emails: one email → one client; invite tracking helpers. */

export function normalizePortalEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function normalizePortalEmailList(list) {
  return [
    ...new Set(
      (Array.isArray(list) ? list : String(list || '').split(/[,\n;]/g))
        .map(normalizePortalEmail)
        .filter(Boolean),
    ),
  ];
}

/**
 * Returns another client already using this email, or null if free.
 * `exceptClientId` allows keeping the email on the client being edited.
 */
export function findClientUsingPortalEmail(clients, email, exceptClientId = null) {
  const want = normalizePortalEmail(email);
  if (!want) return null;
  return (
    (clients || []).find((c) => {
      if (!c || (exceptClientId && c.id === exceptClientId)) return false;
      const emails = Array.isArray(c.clientEmails) ? c.clientEmails : [];
      return emails.map(normalizePortalEmail).includes(want);
    }) || null
  );
}

/** Validates a full email list for uniqueness across clients. */
export function validatePortalEmailsExclusive(clients, emails, exceptClientId = null) {
  const list = normalizePortalEmailList(emails);
  for (const email of list) {
    const other = findClientUsingPortalEmail(clients, email, exceptClientId);
    if (other) {
      return {
        ok: false,
        email,
        otherClientName: other.name || other.id,
        message: `${email} is already authorized on “${other.name || other.id}”. Each email can only access one client.`,
      };
    }
  }
  return { ok: true, emails: list };
}

export function portalInviteStatusLabel(invite) {
  const status = String(invite?.status || '').toLowerCase();
  if (status === 'accepted') return 'Signed in';
  if (status === 'revoked') return 'Revoked';
  if (status === 'pending') return 'Invite pending';
  return 'Not invited';
}

/**
 * Find portal emails that appear on more than one client (legacy data hygiene).
 * Returns [{ email, clients: [{ id, name }] }, ...]
 */
export function findDuplicatePortalEmails(clients) {
  const byEmail = new Map();
  for (const c of clients || []) {
    if (!c) continue;
    const emails = Array.isArray(c.clientEmails) ? c.clientEmails : [];
    for (const raw of emails) {
      const email = normalizePortalEmail(raw);
      if (!email) continue;
      if (!byEmail.has(email)) byEmail.set(email, []);
      byEmail.get(email).push({ id: c.id, name: c.name || c.id });
    }
  }
  return [...byEmail.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([email, list]) => ({ email, clients: list }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

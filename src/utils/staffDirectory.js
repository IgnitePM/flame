export function normalizeStaffEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function staffHandle(email) {
  const local = normalizeStaffEmail(email).split('@')[0];
  return local || '';
}

/** Soft-deactivated staff keep an admins doc so historical notes still resolve. */
export function isAdminDisabled(adminOrDoc) {
  if (!adminOrDoc || typeof adminOrDoc !== 'object') return false;
  return adminOrDoc.disabled === true || adminOrDoc.active === false;
}

export function staffDisplayName(adminOrEmail) {
  if (adminOrEmail && typeof adminOrEmail === 'object') {
    const named = String(
      adminOrEmail.displayName ||
        adminOrEmail.name ||
        adminOrEmail.profileName ||
        '',
    ).trim();
    if (named) return named;
    return staffHandle(adminOrEmail.email || adminOrEmail.id);
  }
  return staffHandle(adminOrEmail);
}

/** Prefer a real name over email local-part for any person-like record. */
export function personDisplayName(personOrEmail, fallback = '') {
  if (personOrEmail && typeof personOrEmail === 'object') {
    return (
      staffDisplayName(personOrEmail) ||
      String(fallback || '').trim() ||
      staffHandle(personOrEmail.email || personOrEmail.id) ||
      'User'
    );
  }
  const email = normalizeStaffEmail(personOrEmail);
  return String(fallback || '').trim() || staffHandle(email) || email || 'User';
}

/**
 * Active staff emails for assignee / mention pickers.
 * Disabled profiles are omitted so departed staff are not re-assigned work,
 * but their admins docs remain for display-name lookups on old notes.
 */
export function collectStaffEmails(adminUsers = [], extra = [], { includeDisabled = false } = {}) {
  return Array.from(
    new Set(
      [
        ...(adminUsers || [])
          .filter((a) => includeDisabled || !isAdminDisabled(a))
          .map((a) => normalizeStaffEmail(a?.email || a?.id)),
        ...(extra || []).map((e) => normalizeStaffEmail(e)),
      ].filter(Boolean),
    ),
  ).sort();
}

export function isSuperAdminUser(user, role) {
  const email = normalizeStaffEmail(user?.email);
  return email === 'chris@ignitepm.com' || role === 'admin';
}

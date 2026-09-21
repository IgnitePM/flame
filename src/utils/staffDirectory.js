export function normalizeStaffEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function staffHandle(email) {
  const local = normalizeStaffEmail(email).split('@')[0];
  return local || '';
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

export function collectStaffEmails(adminUsers = [], extra = []) {
  return Array.from(
    new Set(
      [
        ...(adminUsers || []).map((a) => normalizeStaffEmail(a?.email || a?.id)),
        ...(extra || []).map((e) => normalizeStaffEmail(e)),
      ].filter(Boolean),
    ),
  ).sort();
}

export function isSuperAdminUser(user, role) {
  const email = normalizeStaffEmail(user?.email);
  return email === 'chris@ignitepm.com' || role === 'admin';
}

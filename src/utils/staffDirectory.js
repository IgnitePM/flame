export function normalizeStaffEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function staffHandle(email) {
  const local = normalizeStaffEmail(email).split('@')[0];
  return local || '';
}

export function staffDisplayName(adminOrEmail) {
  if (adminOrEmail && typeof adminOrEmail === 'object') {
    const named = String(adminOrEmail.displayName || '').trim();
    if (named) return named;
    return staffHandle(adminOrEmail.email);
  }
  return staffHandle(adminOrEmail);
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

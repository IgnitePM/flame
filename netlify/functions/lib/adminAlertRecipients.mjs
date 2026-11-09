/**
 * Shared recipient resolution for admin/staff alert emails.
 */

import {
  filterToActiveStaffEmails,
  indexActiveStaffByEmail,
  isStaffDocActive,
} from './activeStaff.mjs';

export function resolveAdminAlertRecipients(settings = {}, adminUsers = []) {
  const active = indexActiveStaffByEmail(adminUsers);
  const configured = Array.isArray(settings.emailDigestRecipients)
    ? settings.emailDigestRecipients
    : [];
  const fromEnv = String(process.env.DIGEST_RECIPIENTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const fromList = filterToActiveStaffEmails(
    [...configured, ...fromEnv],
    active,
  );

  if (fromList.length) return fromList;

  const bot = String(process.env.DIGEST_BOT_EMAIL || '')
    .trim()
    .toLowerCase();
  const staff = (adminUsers || [])
    .filter((a) => isStaffDocActive(a))
    .map((a) => ({
      email: String(a.email || a.id || '').trim().toLowerCase(),
      role: String(a.role || '').trim().toLowerCase(),
    }))
    .filter((a) => a.email && a.email !== bot && a.email.includes('@'));
  const preferred = staff.filter(
    (a) => a.role === 'admin' || a.role === 'billing',
  );
  const pool = preferred.length ? preferred : staff;
  return [...new Set(pool.map((a) => a.email))];
}

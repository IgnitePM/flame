/**
 * Active staff helpers for email / notification recipient lists.
 * Soft-disabled admins keep their doc for name history but must not get mail.
 */

import { isAdminDisabled } from '../../../src/utils/staffDirectory.js';
import { collectAssigneeEmailsFromTodoCycles } from '../../../src/utils/teamClientAccess.js';

export function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

export function isStaffDocActive(adminOrDoc) {
  if (!adminOrDoc || typeof adminOrDoc !== 'object') return false;
  return !isAdminDisabled(adminOrDoc);
}

/** Map of lowercase email → preferred admin doc (canonical id wins). */
export function indexActiveStaffByEmail(adminUsers = []) {
  const map = new Map();
  for (const a of adminUsers || []) {
    if (!isStaffDocActive(a)) continue;
    const email = normalizeEmail(a.email || a.id);
    if (!email.includes('@')) continue;
    const prev = map.get(email);
    if (!prev || a.id === email) map.set(email, a);
  }
  return map;
}

export function filterToActiveStaffEmails(emails, activeByEmail) {
  const active =
    activeByEmail instanceof Map
      ? activeByEmail
      : indexActiveStaffByEmail(activeByEmail);
  return [
    ...new Set(
      (emails || [])
        .map((e) => normalizeEmail(e))
        .filter((e) => e.includes('@') && active.has(e)),
    ),
  ];
}

/** Raw workspace ACL emails (may include inactive / departed staff). */
export function rawTeamAccessEmails(client) {
  const team = Array.isArray(client?.teamMemberAccessEmails)
    ? client.teamMemberAccessEmails
    : [];
  return [
    ...new Set(
      team
        .map((e) => normalizeEmail(e))
        .filter((e) => e.includes('@')),
    ),
  ];
}

/**
 * True when the client ACL looks like the “all kiosk users” seed rather than a
 * curated workspace list — emailing that set for every portal message is noise.
 */
export function teamAccessLooksLikeBroadcast(teamEmails, activeByEmail) {
  const team = (teamEmails || []).map(normalizeEmail).filter(Boolean);
  if (!team.length) return true;
  const active =
    activeByEmail instanceof Map
      ? activeByEmail
      : indexActiveStaffByEmail(activeByEmail);
  const activeKiosk = [...active.entries()]
    .filter(([, a]) => String(a?.role || '').toLowerCase() === 'kiosk')
    .map(([email]) => email);
  if (activeKiosk.length < 3) return false;
  const kioskSet = new Set(activeKiosk);
  const teamKioskCount = team.filter((e) => kioskSet.has(e)).length;
  return teamKioskCount >= Math.max(3, activeKiosk.length - 1);
}

function activeOpsEmails(activeByEmail) {
  const out = [];
  for (const [email, a] of activeByEmail.entries()) {
    const role = String(a?.role || '').toLowerCase();
    if (role === 'admin' || role === 'billing') out.push(email);
  }
  return out;
}

/**
 * Staff who should get client-scoped alert emails (portal messages, feedback,
 * review decisions, etc.).
 *
 * - Always drops inactive / disabled staff.
 * - Curated team ACL → those active people (+ extras).
 * - Broadcast / empty ACL → active admin+billing + open-todo assignees (+ extras).
 */
export function resolveClientAlertStaffEmails(
  client,
  adminUsers = [],
  extra = [],
) {
  const active = indexActiveStaffByEmail(adminUsers);
  const extras = filterToActiveStaffEmails(extra, active);
  const team = filterToActiveStaffEmails(rawTeamAccessEmails(client), active);

  if (team.length && !teamAccessLooksLikeBroadcast(team, active)) {
    return [...new Set([...team, ...extras])];
  }

  const assignees = filterToActiveStaffEmails(
    collectAssigneeEmailsFromTodoCycles(client?.todoCycles),
    active,
  );
  return [...new Set([...activeOpsEmails(active), ...assignees, ...extras])];
}

/**
 * Pure helpers for Drive folder sharing (no Firebase / OAuth imports).
 */

export function portalEmailsFromClient(client) {
  return [
    ...new Set(
      (Array.isArray(client?.clientEmails) ? client.clientEmails : [])
        .map((e) => String(e || '').trim().toLowerCase())
        .filter((e) => e.includes('@')),
    ),
  ];
}

/** True when Drive already has this user permission (idempotent share). */
export function isDrivePermissionAlreadyExistsError(err) {
  const status = Number(err?.status || err?.code || 0);
  if (status === 409) return true;
  const message = String(err?.message || '').toLowerCase();
  return (
    message.includes('already exists') ||
    message.includes('permission already') ||
    message.includes('duplicate')
  );
}

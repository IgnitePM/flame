/**
 * Shared recipient resolution for admin/staff alert emails.
 */

export function resolveAdminAlertRecipients(settings = {}, adminUsers = []) {
  const configured = Array.isArray(settings.emailDigestRecipients)
    ? settings.emailDigestRecipients
    : [];
  const fromEnv = String(process.env.DIGEST_RECIPIENTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const fromList = [...configured, ...fromEnv]
    .map((e) => String(e || '').trim().toLowerCase())
    .filter((e) => e.includes('@'));

  if (fromList.length) return [...new Set(fromList)];

  const bot = String(process.env.DIGEST_BOT_EMAIL || '')
    .trim()
    .toLowerCase();
  const staff = (adminUsers || [])
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

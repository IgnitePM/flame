import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import {
  fetchCollection,
  fetchDoc,
  getDigestDb,
  mergeDoc,
} from './lib/firebaseDigestClient.mjs';
import { sendDigestEmail } from './lib/mailer.mjs';
import { appBaseUrl } from './lib/clientMessaging.mjs';

function resolveAdminAlertRecipients(settings, adminUsers = []) {
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

/**
 * Called after staff sign-in. Emails digest/admin recipients the first time a
 * new staff account logs in (needsFirstLoginNotify). Existing accounts are
 * grandfathered without email.
 */
export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let caller;
  try {
    caller = await requireStaffCaller(req.headers);
  } catch (err) {
    const { status, message } = describeAuthError(err);
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const email = String(caller.email || '').trim().toLowerCase();
  if (!email) {
    return new Response(JSON.stringify({ error: 'Sign in required.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const db = await getDigestDb();
    const path = `admins/${email}`;
    const admin = (await fetchDoc(db, path)) || {};
    const now = Date.now();

    if (admin.firstLoginNotifiedAt) {
      await mergeDoc(db, path, { lastLoginAt: now, updatedAt: now });
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: 'already_notified' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Legacy staff docs (existed before this feature): mark once, do not email.
    if (!admin.needsFirstLoginNotify) {
      await mergeDoc(db, path, {
        firstLoginNotifiedAt: now,
        lastLoginAt: now,
        updatedAt: now,
      });
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: 'legacy_staff' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Claim the notify flag first so parallel tabs do not double-send.
    await mergeDoc(db, path, {
      needsFirstLoginNotify: false,
      firstLoginAt: Number(admin.firstLoginAt || now),
      firstLoginNotifiedAt: now,
      lastLoginAt: now,
      updatedAt: now,
      displayName:
        admin.displayName ||
        String(caller.name || caller.displayName || '').trim() ||
        null,
    });

    const settings = (await fetchDoc(db, 'settings/notifications')) || {};
    const adminUsers = await fetchCollection(db, 'admins').catch(() => []);
    const recipients = resolveAdminAlertRecipients(settings, adminUsers).filter(
      (e) => e !== email,
    );

    if (!recipients.length) {
      return new Response(
        JSON.stringify({
          ok: true,
          emailed: false,
          reason: 'no_recipients',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const role = String(admin.role || caller.role || 'kiosk').trim() || 'kiosk';
    const when = new Date(now).toLocaleString('en-CA', {
      timeZone: 'America/Toronto',
    });
    const href = `${appBaseUrl()}/admin`;
    const subject = `New staff login — ${email}`;
    const bodyText = [
      `${email} signed in to Ignite Time Tracker for the first time.`,
      '',
      `Role: ${role}`,
      `When: ${when} (America/Toronto)`,
      '',
      'If this was unexpected, review Users in Admin and adjust their access.',
    ].join('\n');
    const html = `<!DOCTYPE html><html><body style="margin:0;padding:24px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a;">
  <p style="font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#fd7414;">Ignite PM · Staff access</p>
  <h1 style="font-size:20px;margin:8px 0 16px;">New staff login</h1>
  <p style="font-size:14px;line-height:1.55;"><strong>${email}</strong> signed in for the first time.</p>
  <p style="font-size:14px;line-height:1.55;">Role: <strong>${role}</strong><br/>When: ${when} (America/Toronto)</p>
  <p style="margin-top:24px;"><a href="${href}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:12px 18px;border-radius:12px;font-size:12px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;">Open Admin</a></p>
</body></html>`;

    await sendDigestEmail({
      to: recipients,
      subject,
      text: bodyText,
      html,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        emailed: true,
        recipientCount: recipients.length,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[notify-staff-first-login]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not record first login.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

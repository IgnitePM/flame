import {
  fetchCollection,
  fetchDoc,
  getDigestDb,
  mergeDoc,
} from './firebaseDigestClient.mjs';
import { sendDigestEmail } from './mailer.mjs';
import {
  buildAssignmentAlertForUser,
  buildPersonalDigestForUser,
} from './personalDigestContext.mjs';
import {
  renderAssignmentAlertHtml,
  renderAssignmentAlertText,
  renderPersonalDigestHtml,
  renderPersonalDigestText,
} from './renderPersonalDigestEmail.mjs';

const NOTIF_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

async function loadNotifySettings(db) {
  return (await fetchDoc(db, 'settings/notifications')) || {};
}

function resolveRecipients(settings, adminUsers = []) {
  const configured = Array.isArray(settings.emailDigestRecipients)
    ? settings.emailDigestRecipients
    : [];
  const fromEnv = String(process.env.DIGEST_RECIPIENTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const fromList = [...configured, ...fromEnv]
    .map((e) => String(e || '').trim().toLowerCase())
    .filter(Boolean);

  // If no explicit list, email all staff with an admins/{email} doc
  // (except the digest bot itself).
  if (!fromList.length) {
    const bot = String(process.env.DIGEST_BOT_EMAIL || '')
      .trim()
      .toLowerCase();
    return (adminUsers || [])
      .map((a) => String(a.email || a.id || '').trim().toLowerCase())
      .filter((e) => e && e !== bot && e.includes('@'));
  }
  return [...new Set(fromList)];
}

function adminByEmail(adminUsers = []) {
  const map = new Map();
  for (const a of adminUsers || []) {
    const email = String(a.email || a.id || '')
      .trim()
      .toLowerCase();
    if (!email) continue;
    map.set(email, a);
  }
  return map;
}

/**
 * Per-user morning/weekly digests. Replaces the old shared workspace brief.
 * Each recipient gets only their assignments, dues, mentions, and (if enabled) sales.
 */
export async function runWorkspaceDigest(period) {
  const db = await getDigestDb();
  const settings = await loadNotifySettings(db);

  if (settings.emailDigestEnabled === false) {
    return { skipped: true, reason: 'Email digests are disabled in settings/notifications.' };
  }
  const enabledKey = period === 'weekly' ? 'emailWeeklyEnabled' : 'emailDailyEnabled';
  if (settings[enabledKey] === false) {
    return { skipped: true, reason: `${period} digest is disabled in settings/notifications.` };
  }

  const notifCutoff = Date.now() - NOTIF_LOOKBACK_MS;
  const [clients, adminUsers, notifications, deals, leads, salesPipeline] =
    await Promise.all([
      fetchCollection(db, 'clients'),
      fetchCollection(db, 'admins'),
      fetchCollection(db, 'notifications', {
        where: [['createdAt', '>=', notifCutoff]],
      }),
      fetchCollection(db, 'deals').catch(() => []),
      fetchCollection(db, 'leads').catch(() => []),
      fetchDoc(db, 'settings/salesPipeline'),
    ]);

  const recipients = resolveRecipients(settings, adminUsers);
  if (!recipients.length) {
    return {
      skipped: true,
      reason:
        'No digest recipients configured (set Email Digests recipients, DIGEST_RECIPIENTS, or ensure admins exist).',
    };
  }

  const admins = adminByEmail(adminUsers);
  const generatedAt = new Date();
  const dateLabel = generatedAt.toLocaleDateString('en-CA', {
    timeZone: 'America/Toronto',
  });
  const sent = [];
  const empty = [];
  const errors = [];

  for (const email of recipients) {
    try {
      const digest = buildPersonalDigestForUser({
        email,
        adminDoc: admins.get(email) || { email },
        clients,
        notifications,
        deals,
        leads,
        salesPipeline,
        period,
      });
      const subject =
        period === 'weekly'
          ? `Your weekly update — ${dateLabel}`
          : `Your morning update — ${dateLabel}`;
      const text = renderPersonalDigestText(digest);
      const html = renderPersonalDigestHtml({ digest, generatedAt });
      await sendDigestEmail({ to: email, subject, text, html });
      if (digest.hasContent) sent.push(email);
      else empty.push(email);
    } catch (err) {
      errors.push({ email, error: err?.message || String(err) });
    }
  }

  return {
    sent: true,
    period,
    personalized: true,
    recipientCount: recipients.length,
    withContent: sent.length,
    emptyBriefings: empty.length,
    errors,
  };
}

/**
 * Every ~15 minutes: email staff who received new task_assigned notifications
 * since the last successful run (watermark in settings/digestCursor).
 */
export async function runAssignmentAlerts() {
  const db = await getDigestDb();
  const settings = await loadNotifySettings(db);

  if (settings.emailDigestEnabled === false) {
    return { skipped: true, reason: 'Email digests are disabled.' };
  }
  if (settings.emailAssignmentAlertsEnabled === false) {
    return { skipped: true, reason: 'Assignment alerts are disabled.' };
  }

  const cursor = (await fetchDoc(db, 'settings/digestCursor')) || {};
  const now = Date.now();
  // Default: look back 20 minutes on first run so we don't dump a huge backlog.
  const sinceMs = Number(cursor.lastAssignmentAlertAt || now - 20 * 60 * 1000);
  const adminUsers = await fetchCollection(db, 'admins');
  const recipients = resolveRecipients(settings, adminUsers);
  if (!recipients.length) {
    return { skipped: true, reason: 'No recipients configured.' };
  }

  const notifications = await fetchCollection(db, 'notifications', {
    where: [['createdAt', '>=', sinceMs]],
  });

  const generatedAt = new Date();
  const sent = [];
  const errors = [];

  for (const email of recipients) {
    try {
      const alert = buildAssignmentAlertForUser({
        email,
        notifications,
        sinceMs,
      });
      if (!alert.items.length) continue;
      const count = alert.items.length;
      const subject =
        count === 1
          ? `New task assigned: ${alert.items[0].title}`
          : `${count} new tasks assigned to you`;
      await sendDigestEmail({
        to: email,
        subject,
        text: renderAssignmentAlertText(alert),
        html: renderAssignmentAlertHtml({ alert, generatedAt }),
      });
      sent.push({ email, count });
    } catch (err) {
      errors.push({ email, error: err?.message || String(err) });
    }
  }

  await mergeDoc(db, 'settings/digestCursor', {
    lastAssignmentAlertAt: now,
    lastAssignmentAlertAtIso: new Date(now).toISOString(),
  });

  return {
    sent: true,
    alerted: sent.length,
    details: sent,
    errors,
    sinceMs,
  };
}

import { fetchCollection, fetchDoc, getDigestDb } from './firebaseDigestClient.mjs';
import { buildWorkspaceDigestPayload } from './workspaceDigestContext.mjs';
import { sendDigestEmail } from './mailer.mjs';
import { renderDigestHtml } from './renderDigestEmail.mjs';

// Covers current + previous billing cycle for any billing day, plus the
// 14-day timesheet lookback compactTimesheets() uses, with headroom.
const HISTORY_CUTOFF_MS = 70 * 24 * 60 * 60 * 1000;

async function loadNotifySettings(db) {
  return (await fetchDoc(db, 'settings/notifications')) || {};
}

function resolveRecipients(settings) {
  const configured = Array.isArray(settings.emailDigestRecipients)
    ? settings.emailDigestRecipients
    : [];
  const fromEnv = String(process.env.DIGEST_RECIPIENTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [
    ...new Set(
      [...configured, ...fromEnv].map((e) => String(e || '').trim().toLowerCase()).filter(Boolean),
    ),
  ];
}

async function summarizeViaGemini(context, period) {
  const baseUrl = process.env.URL || process.env.DEPLOY_URL || process.env.DEPLOY_PRIME_URL;
  if (!baseUrl) {
    throw new Error(
      'Could not resolve the site URL to call gemini-summarize (missing process.env.URL).',
    );
  }
  const resp = await fetch(`${baseUrl}/.netlify/functions/gemini-summarize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: { ...context, period } }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data?.summary) {
    throw new Error(data?.error || 'gemini-summarize did not return a summary.');
  }
  return data.summary;
}

/**
 * Runs one workspace digest (daily|weekly) end to end: reads Firestore,
 * builds the AI brief payload, summarizes it with Gemini, and emails it via
 * Gmail SMTP to the configured recipients.
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

  const recipients = resolveRecipients(settings);
  if (!recipients.length) {
    return { skipped: true, reason: 'No digest recipients configured.' };
  }

  const cutoff = Date.now() - HISTORY_CUTOFF_MS;
  const [clients, timesheets, taskLogs, expenses, addons] = await Promise.all([
    fetchCollection(db, 'clients'),
    fetchCollection(db, 'timesheets', { where: [['clockInTime', '>=', cutoff]] }),
    fetchCollection(db, 'taskLogs', { where: [['clockInTime', '>=', cutoff]] }),
    fetchCollection(db, 'expenses', { where: [['date', '>=', cutoff]] }),
    fetchCollection(db, 'addons'),
  ]);

  const context = buildWorkspaceDigestPayload({ clients, timesheets, taskLogs, expenses, addons });
  const summary = await summarizeViaGemini(context, period);
  const generatedAt = new Date();

  const dateLabel = generatedAt.toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
  const subject =
    period === 'weekly'
      ? `Weekly workspace update — ${dateLabel}`
      : `Daily workspace update — ${dateLabel}`;

  await sendDigestEmail({
    to: recipients,
    subject,
    text: summary,
    html: renderDigestHtml({ period, summary, generatedAt }),
  });

  return { sent: true, recipients, period, subject };
}

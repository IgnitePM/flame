/**
 * Helpers for client portal Messages + Approvals (SMTP notify + Firestore writes).
 */

import { sendDigestEmail } from './mailer.mjs';
import { writeClientActivity } from './clientActivity.mjs';
import { fetchDoc, getDigestDb, mergeDoc } from './firebaseDigestClient.mjs';

export function appBaseUrl() {
  return String(
    process.env.PORTAL_APP_URL ||
      process.env.URL ||
      process.env.DEPLOY_PRIME_URL ||
      'https://ignitetimetracker.netlify.app',
  ).replace(/\/$/, '');
}

export function normalizeAttachments(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((a, i) => ({
      id: String(a?.id || `att_${Date.now()}_${i}`),
      name: String(a?.name || 'Attachment').trim() || 'Attachment',
      url: String(a?.url || '').trim(),
      driveFileId: a?.driveFileId ? String(a.driveFileId) : null,
      mimeType: a?.mimeType ? String(a.mimeType) : null,
      sizeBytes: Number(a?.sizeBytes || 0) || 0,
    }))
    .filter((a) => a.url)
    .slice(0, 20);
}

export async function loadClient(clientId) {
  const db = await getDigestDb();
  const client = await fetchDoc(db, `clients/${clientId}`);
  if (!client) throw new Error('Client not found.');
  return { id: clientId, ...client };
}

function portalEmails(client) {
  return [
    ...new Set(
      (Array.isArray(client?.clientEmails) ? client.clientEmails : [])
        .map((e) => String(e || '').trim().toLowerCase())
        .filter((e) => e.includes('@')),
    ),
  ];
}

function staffNotifyEmails(client) {
  const team = Array.isArray(client?.teamMemberAccessEmails)
    ? client.teamMemberAccessEmails
    : [];
  return [
    ...new Set(
      team
        .map((e) => String(e || '').trim().toLowerCase())
        .filter((e) => e.includes('@')),
    ),
  ];
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function emailShell({ eyebrow, title, bodyText, ctaLabel, ctaHref }) {
  const safeBody = escapeHtml(bodyText).replace(/\n/g, '<br/>');
  return {
    text: `${title}\n\n${bodyText}\n\n${ctaLabel}: ${ctaHref}`,
    html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:32px auto;background:#fff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;">
    <div style="padding:24px 28px;">
      <div style="font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#fd7414;">${escapeHtml(eyebrow)}</div>
      <h1 style="font-size:20px;margin:12px 0 16px;color:#0f172a;">${escapeHtml(title)}</h1>
      <div style="font-size:14px;line-height:1.55;color:#334155;white-space:pre-wrap;">${safeBody}</div>
      <p style="margin:28px 0 0;">
        <a href="${escapeHtml(ctaHref)}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:12px 18px;border-radius:12px;font-size:12px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;">${escapeHtml(ctaLabel)}</a>
      </p>
    </div>
  </div>
</body></html>`,
  };
}

export async function notifyPortalNewMessage({ client, messageBody, authorName }) {
  const to = portalEmails(client);
  if (!to.length) return { sent: 0, skipped: 'no_portal_emails' };
  const href = appBaseUrl();
  const { text, html } = emailShell({
    eyebrow: 'Ignite PM · Messages',
    title: `New message from Ignite — ${client.name || 'your account'}`,
    bodyText: `${authorName || 'Ignite'} wrote:\n\n${messageBody}`,
    ctaLabel: 'Open portal',
    ctaHref: href,
  });
  await sendDigestEmail({
    to,
    subject: `New message from Ignite — ${client.name || 'Client portal'}`,
    text,
    html,
  });
  return { sent: to.length };
}

export async function notifyStaffClientMessage({ client, messageBody, authorEmail }) {
  const to = staffNotifyEmails(client);
  if (!to.length) return { sent: 0, skipped: 'no_staff_emails' };
  const href = `${appBaseUrl()}/clients/${client.id}?tab=messages`;
  const { text, html } = emailShell({
    eyebrow: 'Ignite PM · Messages',
    title: `New portal message — ${client.name || 'Client'}`,
    bodyText: `${authorEmail || 'Client'} wrote:\n\n${messageBody}`,
    ctaLabel: 'Open in CRM',
    ctaHref: href,
  });
  await sendDigestEmail({
    to,
    subject: `New portal message — ${client.name || 'Client'}`,
    text,
    html,
  });
  return { sent: to.length };
}

export async function notifyPortalReviewSent({ client, title, description }) {
  const to = portalEmails(client);
  if (!to.length) return { sent: 0, skipped: 'no_portal_emails' };
  const href = appBaseUrl();
  const { text, html } = emailShell({
    eyebrow: 'Ignite PM · Approvals',
    title: `Please approve: ${title}`,
    bodyText: description || 'A new deliverable is ready for your approval in the client portal.',
    ctaLabel: 'Open portal',
    ctaHref: href,
  });
  await sendDigestEmail({
    to,
    subject: `Please approve: ${title}`,
    text,
    html,
  });
  return { sent: to.length };
}

export async function notifyStaffReviewDecision({ client, title, status, note, byEmail }) {
  const to = staffNotifyEmails(client);
  if (!to.length) return { sent: 0, skipped: 'no_staff_emails' };
  const label = status === 'approved' ? 'Approved' : 'Revisions requested';
  const href = `${appBaseUrl()}/clients/${client.id}?tab=approvals`;
  const { text, html } = emailShell({
    eyebrow: 'Ignite PM · Approvals',
    title: `${label}: ${title}`,
    bodyText: `${byEmail || 'Client'} responded on ${client.name || 'client'}.\n\n${note || '(no note)'}`,
    ctaLabel: 'Open in CRM',
    ctaHref: href,
  });
  await sendDigestEmail({
    to,
    subject: `${label}: ${title} — ${client.name || 'Client'}`,
    text,
    html,
  });
  return { sent: to.length };
}

export async function notifyPortalTodoApprovalSent({ client, title, note }) {
  const to = portalEmails(client);
  if (!to.length) return { sent: 0, skipped: 'no_portal_emails' };
  const href = `${appBaseUrl()}?tab=tasks`;
  const { text, html } = emailShell({
    eyebrow: 'Ignite PM · Task approval',
    title: `Please review: ${title}`,
    bodyText:
      note ||
      'A task is ready for your review in the client portal. Approve it or request revisions.',
    ctaLabel: 'Open portal tasks',
    ctaHref: href,
  });
  await sendDigestEmail({
    to,
    subject: `Please review task: ${title}`,
    text,
    html,
  });
  return { sent: to.length };
}

export async function notifyPortalTodoNoteMention({
  client,
  taskTitle,
  commentText,
  authorName,
  mentionedEmails = [],
}) {
  const allowed = new Set(portalEmails(client));
  const to = [
    ...new Set(
      (mentionedEmails || [])
        .map((e) => String(e || '').trim().toLowerCase())
        .filter((e) => e.includes('@') && allowed.has(e)),
    ),
  ];
  if (!to.length) return { sent: 0, skipped: 'no_matching_portal_emails' };
  const href = appBaseUrl();
  const title = String(taskTitle || 'Task').trim() || 'Task';
  const { text, html } = emailShell({
    eyebrow: 'Ignite PM · Task note',
    title: `You were tagged on: ${title}`,
    bodyText: `${authorName || 'Ignite'} tagged you on ${
      client.name || 'your account'
    }:\n\n${commentText || '(no note text)'}`,
    ctaLabel: 'Open portal',
    ctaHref: href,
  });
  await sendDigestEmail({
    to,
    subject: `Tagged on task: ${title} — ${client.name || 'Client'}`,
    text,
    html,
  });
  return { sent: to.length };
}

export async function notifyStaffTodoReviewRequested({
  client,
  title,
  note,
  byEmail,
  reviewerEmails = [],
}) {
  const to = [
    ...new Set(
      (reviewerEmails || [])
        .map((e) => String(e || '').trim().toLowerCase())
        .filter((e) => e.includes('@')),
    ),
  ];
  if (!to.length) return { sent: 0, skipped: 'no_reviewers' };
  const href = `${appBaseUrl()}/clients/${client.id}?tab=tasks`;
  const { text, html } = emailShell({
    eyebrow: 'Ignite PM · Staff review',
    title: `Review requested: ${title}`,
    bodyText: `${byEmail || 'A teammate'} asked you to review this task on ${
      client.name || 'a client'
    }.\n\n${note || '(no note)'}`,
    ctaLabel: 'Open tasks',
    ctaHref: href,
  });
  await sendDigestEmail({
    to,
    subject: `Review task: ${title} — ${client.name || 'Client'}`,
    text,
    html,
  });
  return { sent: to.length };
}

export async function notifyStaffTodoApprovalDecision({
  client,
  title,
  status,
  note,
  byEmail,
  notifyEmails = [],
}) {
  const fallback = staffNotifyEmails(client);
  const to = [
    ...new Set(
      [...(notifyEmails || []), ...fallback]
        .map((e) => String(e || '').trim().toLowerCase())
        .filter((e) => e.includes('@')),
    ),
  ];
  if (!to.length) return { sent: 0, skipped: 'no_staff_emails' };
  const label = status === 'approved' ? 'Approved' : 'Revisions requested';
  const href = `${appBaseUrl()}/clients/${client.id}?tab=tasks`;
  const { text, html } = emailShell({
    eyebrow: 'Ignite PM · Task approval',
    title: `${label}: ${title}`,
    bodyText: `${byEmail || 'Someone'} responded on ${client.name || 'client'}.\n\n${
      note || '(no note)'
    }`,
    ctaLabel: 'Open tasks',
    ctaHref: href,
  });
  await sendDigestEmail({
    to,
    subject: `${label}: ${title} — ${client.name || 'Client'}`,
    text,
    html,
  });
  return { sent: to.length };
}

export async function notifyStaffMentions({
  client,
  messageBody,
  authorName,
  mentionedEmails = [],
}) {
  const to = [
    ...new Set(
      (mentionedEmails || [])
        .map((e) => String(e || '').trim().toLowerCase())
        .filter((e) => e.includes('@')),
    ),
  ];
  if (!to.length) return { sent: 0, skipped: 'no_mentions' };
  const href = `${appBaseUrl()}/clients/${client.id}?tab=messages`;
  const { text, html } = emailShell({
    eyebrow: 'Ignite PM · Mention',
    title: `You were mentioned — ${client.name || 'Client'}`,
    bodyText: `${authorName || 'Someone'} tagged you in Messages:\n\n${messageBody}`,
    ctaLabel: 'Open conversation',
    ctaHref: href,
  });
  await sendDigestEmail({
    to,
    subject: `Mentioned in Messages — ${client.name || 'Client'}`,
    text,
    html,
  });
  return { sent: to.length };
}

export async function createMessageDoc(fields) {
  const db = await getDigestDb();
  const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const doc = {
    ...fields,
    id,
    createdAt: Number(fields.createdAt) || Date.now(),
    updatedAt: Date.now(),
  };
  await mergeDoc(db, `clientMessages/${id}`, doc);
  return doc;
}

/**
 * Write kiosk/admin inbox rows under `notifications` for staff recipients.
 * Skips the actor email. Uses Admin SDK (bypasses client Firestore rules).
 */
export async function writeStaffInboxNotifications({
  recipientEmails = [],
  type,
  title,
  body = '',
  actorEmail = '',
  actorName = '',
  clientId = null,
  clientName = null,
  categoryKey = null,
  itemId = null,
  idPrefix = 'inbox',
}) {
  const recipients = [
    ...new Set(
      (recipientEmails || [])
        .map((e) => String(e || '').trim().toLowerCase())
        .filter((e) => e.includes('@')),
    ),
  ];
  const actor = String(actorEmail || '').trim().toLowerCase();
  const targets = recipients.filter((e) => e && e !== actor);
  if (!targets.length || !type || !title) return { written: 0 };

  const db = await getDigestDb();
  const now = Date.now();
  let written = 0;
  for (const email of targets) {
    const safeEmail = email.replace(/[^a-z0-9]/gi, '_').slice(0, 48);
    const notifId = `${idPrefix}_${now}_${safeEmail}_${Math.random()
      .toString(36)
      .slice(2, 7)}`;
    await mergeDoc(db, `notifications/${notifId}`, {
      recipientEmail: email,
      type: String(type),
      title: String(title).slice(0, 200),
      body: String(body || '').slice(0, 500),
      createdAt: now,
      dismissed: false,
      dismissedAt: null,
      actorEmail: actor || null,
      actorName: String(actorName || '').slice(0, 80),
      clientId: clientId || null,
      clientName: clientName || null,
      categoryKey: categoryKey || null,
      itemId: itemId || null,
      commentId: null,
    });
    written += 1;
  }
  return { written };
}

/** Staff emails that typically get client-scoped alerts. */
export function collectClientStaffNotifyEmails(client, extra = []) {
  return [
    ...new Set(
      [...staffNotifyEmails(client), ...(extra || [])]
        .map((e) => String(e || '').trim().toLowerCase())
        .filter((e) => e.includes('@')),
    ),
  ];
}

export async function createReviewDoc(fields) {
  const db = await getDigestDb();
  const id = `rev_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const doc = {
    ...fields,
    id,
    createdAt: Number(fields.createdAt) || Date.now(),
    updatedAt: Date.now(),
  };
  await mergeDoc(db, `clientReviews/${id}`, doc);
  return doc;
}

export async function createFeedbackDoc(fields) {
  const db = await getDigestDb();
  const id = `feedback_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const doc = {
    ...fields,
    id,
    createdAt: Number(fields.createdAt) || Date.now(),
    updatedAt: Date.now(),
  };
  await mergeDoc(db, `clientPortalFeedback/${id}`, doc);
  return doc;
}

export async function notifyStaffPortalFeedback({
  client,
  type,
  subject,
  body,
  byEmail,
  notifyEmails = [],
}) {
  const fallback = staffNotifyEmails(client);
  const to = [
    ...new Set(
      [...(notifyEmails || []), ...fallback]
        .map((e) => String(e || '').trim().toLowerCase())
        .filter((e) => e.includes('@')),
    ),
  ];
  if (!to.length) return { sent: 0, skipped: 'no_staff_emails' };
  const kind = type === 'bug' ? 'Bug report' : 'Feedback';
  const href = `${appBaseUrl()}/clients/${client.id}`;
  const { text, html } = emailShell({
    eyebrow: 'Ignite PM · Portal feedback',
    title: `${kind}: ${subject || 'Portal note'}`,
    bodyText: `${byEmail || 'A client contact'} submitted ${kind.toLowerCase()} for ${
      client.name || 'a client'
    }.\n\n${body || '(no details)'}`,
    ctaLabel: 'Open client',
    ctaHref: href,
  });
  await sendDigestEmail({
    to,
    subject: `${kind}: ${subject || 'Portal'} — ${client.name || 'Client'}`,
    text,
    html,
  });
  return { sent: to.length };
}

export async function updateReviewDoc(reviewId, patch) {
  const db = await getDigestDb();
  await mergeDoc(db, `clientReviews/${reviewId}`, {
    ...patch,
    updatedAt: Date.now(),
  });
}

export { writeClientActivity, fetchDoc, getDigestDb, mergeDoc };

/**
 * Gmail SMTP sender for workspace digests.
 *
 * Requires Netlify env vars:
 *   GMAIL_USER          — Gmail address to send from
 *   GMAIL_APP_PASSWORD  — Google Account App Password (not the login password;
 *                          requires 2-Step Verification enabled on the account)
 *   GMAIL_FROM_NAME     — optional display name (default: "Ignite PM Workspace")
 *
 * Note: Gmail SMTP is fine for a small internal team digest. It is not meant
 * for high-volume or transactional email at scale.
 */

import nodemailer from 'nodemailer';

let cachedTransporter = null;

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error('Missing GMAIL_USER or GMAIL_APP_PASSWORD environment variables.');
  }
  cachedTransporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass },
  });
  return cachedTransporter;
}

export async function sendDigestEmail({ to, subject, text, html }) {
  const user = process.env.GMAIL_USER;
  const fromName = process.env.GMAIL_FROM_NAME || 'Ignite PM Workspace';
  const transporter = getTransporter();
  return transporter.sendMail({
    from: `"${fromName}" <${user}>`,
    to: Array.isArray(to) ? to.join(', ') : to,
    subject,
    text,
    html,
  });
}

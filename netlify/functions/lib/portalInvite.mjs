/**
 * Invite-only client portal accounts (no public signup).
 *
 * Creates/ensures a Firebase Auth email+password user via Identity Toolkit
 * REST (no service-account key), sends Firebase's password-reset / set-password
 * email, and tracks status in portalInvites/{email}.
 */

import {
  fetchCollection,
  fetchDoc,
  getDigestDb,
  mergeDoc,
} from './firebaseDigestClient.mjs';
import { sendDigestEmail } from './mailer.mjs';

const SIGN_UP_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:signUp';
const OOB_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode';

const REMIND_EVERY_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_REMINDERS = 5;

function apiKey() {
  const key = process.env.VITE_FIREBASE_API_KEY;
  if (!key) throw new Error('Missing VITE_FIREBASE_API_KEY in Functions scope.');
  return key;
}

function normEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function randomPassword() {
  const alphabet =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  let out = '';
  for (let i = 0; i < 28; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function appLoginUrl() {
  return (
    process.env.PORTAL_APP_URL ||
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    'https://ignitetimetracker.netlify.app'
  );
}

async function ensureAuthUser(email) {
  const resp = await fetch(`${SIGN_UP_URL}?key=${encodeURIComponent(apiKey())}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: randomPassword(),
      returnSecureToken: false,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (resp.ok) return { created: true };
  const msg = String(data?.error?.message || '');
  if (msg.includes('EMAIL_EXISTS')) return { created: false };
  throw new Error(msg || 'Could not create portal login.');
}

async function sendFirebasePasswordReset(email) {
  const resp = await fetch(`${OOB_URL}?key=${encodeURIComponent(apiKey())}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestType: 'PASSWORD_RESET',
      email,
      // Helps some clients return to the app after reset.
      continueUrl: appLoginUrl(),
      canHandleCodeInApp: false,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.error?.message || 'Could not send set-password email.');
  }
}

async function sendBrandedInviteEmail({
  to,
  clientName,
  isReminder = false,
}) {
  const loginUrl = appLoginUrl();
  const subject = isReminder
    ? `Reminder: set up your ${clientName} portal access`
    : `You're invited to the ${clientName} client portal`;
  const text = [
    `Hi,`,
    '',
    isReminder
      ? `This is a reminder to finish setting up your Ignite PM client portal access for ${clientName}.`
      : `You've been invited to the Ignite PM client portal for ${clientName}.`,
    '',
    `1) Check your inbox for a separate Firebase email with a link to set your password.`,
    `2) Then sign in at ${loginUrl} with this email (Google Workspace sign-in also works if you use Google with the same address).`,
    '',
    `If you don't see the set-password email, use "Forgot Password?" on the login page or ask your Ignite contact to resend the invite.`,
    '',
    `— Ignite PM`,
  ].join('\n');
  const html = `<html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a;line-height:1.5;padding:24px;">
  <div style="max-width:560px;margin:0 auto;">
    <div style="font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#fd7414;">Ignite PM · Client portal</div>
    <h1 style="font-size:20px;margin:8px 0 12px;">${isReminder ? 'Reminder: set your password' : 'You are invited'}</h1>
    <p>Portal access for <strong>${String(clientName || '').replace(/</g, '')}</strong>.</p>
    <ol>
      <li>Open the separate email with your <strong>set password</strong> link.</li>
      <li>Sign in at <a href="${loginUrl}">${loginUrl}</a> with this email (or Google, if you use the same address).</li>
    </ol>
    <p style="color:#64748b;font-size:13px;">If the set-password email is missing, use Forgot Password on the login page or ask Ignite to resend.</p>
  </div>
</body></html>`;
  try {
    await sendDigestEmail({ to, subject, text, html });
    return true;
  } catch (err) {
    // Firebase reset email is the critical path; branded mail is best-effort.
    console.warn('[portalInvite] branded email skipped:', err?.message || err);
    return false;
  }
}

async function assertEmailOnClientOnly(db, email, clientId) {
  const clients = await fetchCollection(db, 'clients');
  const matches = clients.filter((c) => {
    const emails = Array.isArray(c.clientEmails) ? c.clientEmails : [];
    return emails.map(normEmail).includes(email);
  });
  if (!matches.some((c) => c.id === clientId)) {
    throw new Error(
      'That email is not on this client’s authorized portal list. Add it under Authorized Emails and save first.',
    );
  }
  const other = matches.find((c) => c.id !== clientId);
  if (other) {
    throw new Error(
      `That email is already authorized on “${other.name || other.id}”. Each email can only access one client.`,
    );
  }
  return matches.find((c) => c.id === clientId);
}

async function assertNotStaff(db, email) {
  const adminDoc = await fetchDoc(db, `admins/${email}`);
  if (adminDoc) {
    throw new Error(
      'That email belongs to a staff account. Staff use the internal app, not the client portal invite.',
    );
  }
}

/**
 * @param {{ clientId: string, email: string, invitedBy: string, isReminder?: boolean }} args
 */
export async function invitePortalUser({
  clientId,
  email,
  invitedBy,
  isReminder = false,
} = {}) {
  const em = normEmail(email);
  const cid = String(clientId || '').trim();
  if (!em || !em.includes('@')) throw new Error('Enter a valid email address.');
  if (!cid) throw new Error('Missing client.');

  const db = await getDigestDb();
  await assertNotStaff(db, em);
  const client = await assertEmailOnClientOnly(db, em, cid);

  const authResult = await ensureAuthUser(em);
  await sendFirebasePasswordReset(em);
  await sendBrandedInviteEmail({
    to: em,
    clientName: client.name || 'your account',
    isReminder,
  });

  const prev = (await fetchDoc(db, `portalInvites/${em}`)) || {};
  const now = Date.now();
  const remindCount = isReminder
    ? Number(prev.remindCount || 0) + 1
    : Number(prev.remindCount || 0);

  await mergeDoc(db, `portalInvites/${em}`, {
    email: em,
    clientId: cid,
    clientName: client.name || '',
    status: 'pending',
    invitedAt: prev.invitedAt || now,
    invitedBy: invitedBy || prev.invitedBy || '',
    lastInvitedAt: now,
    lastRemindedAt: isReminder ? now : prev.lastRemindedAt || null,
    remindCount,
    authCreatedOnInvite: prev.authCreatedOnInvite || authResult.created,
    updatedAt: now,
  });

  try {
    const { notifyClientSlack } = await import('./clientSlack.mjs');
    const settings = (await fetchDoc(db, 'settings/notifications')) || {};
    await notifyClientSlack({
      clientId: cid,
      alsoGlobal: !!settings.notifyPortalInvitesGlobal,
      text: isReminder
        ? `:bell: Portal invite reminder sent to ${em} for *${client.name || 'client'}*.`
        : `:mailbox_with_mail: Portal invite sent to ${em} for *${client.name || 'client'}*.`,
    });
  } catch (err) {
    console.warn('[portalInvite] slack notify skipped:', err?.message || err);
  }

  return {
    ok: true,
    email: em,
    clientId: cid,
    createdAuthUser: authResult.created,
    reminded: !!isReminder,
  };
}

export async function markPortalInviteAccepted(email) {
  const em = normEmail(email);
  if (!em) return;
  const db = await getDigestDb();
  const prev = await fetchDoc(db, `portalInvites/${em}`);
  if (!prev || prev.status === 'accepted') return;
  await mergeDoc(db, `portalInvites/${em}`, {
    status: 'accepted',
    acceptedAt: Date.now(),
    updatedAt: Date.now(),
  });
}

export async function markPortalInviteRevoked(email) {
  const em = normEmail(email);
  if (!em) return;
  const db = await getDigestDb();
  const prev = await fetchDoc(db, `portalInvites/${em}`);
  if (!prev) return;
  await mergeDoc(db, `portalInvites/${em}`, {
    status: 'revoked',
    revokedAt: Date.now(),
    updatedAt: Date.now(),
  });
}

/** Daily job: resend set-password for pending invites that went quiet. */
export async function runPortalInviteReminders({ now = Date.now() } = {}) {
  const db = await getDigestDb();
  const invites = await fetchCollection(db, 'portalInvites');
  const sent = [];
  const skipped = [];
  const errors = [];

  for (const inv of invites || []) {
    const email = normEmail(inv.email || inv.id);
    if (!email || inv.status !== 'pending') {
      skipped.push({ email, reason: 'not_pending' });
      continue;
    }
    if (Number(inv.remindCount || 0) >= MAX_REMINDERS) {
      skipped.push({ email, reason: 'max_reminders' });
      continue;
    }
    const last =
      Number(inv.lastRemindedAt || inv.lastInvitedAt || inv.invitedAt || 0) || 0;
    if (now - last < REMIND_EVERY_MS) {
      skipped.push({ email, reason: 'too_soon' });
      continue;
    }
    // Still authorized on the client?
    try {
      await assertEmailOnClientOnly(db, email, inv.clientId);
    } catch {
      await markPortalInviteRevoked(email);
      skipped.push({ email, reason: 'no_longer_authorized' });
      continue;
    }
    try {
      await invitePortalUser({
        clientId: inv.clientId,
        email,
        invitedBy: 'reminder-bot',
        isReminder: true,
      });
      sent.push(email);
    } catch (err) {
      errors.push({ email, error: err?.message || String(err) });
    }
  }

  return {
    sent: sent.length,
    details: sent,
    skipped: skipped.length,
    errors,
  };
}

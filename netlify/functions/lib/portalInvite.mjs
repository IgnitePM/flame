/**
 * Invite-only client portal accounts (no public signup).
 *
 * Creates/ensures a Firebase Auth email+password user via Identity Toolkit
 * REST (no service-account key), emails a **custom** set-password link to our
 * app (scanner-safe: GET does nothing; password is set only on form submit),
 * and tracks status in portalInvites/{email}.
 */

import { randomBytes } from 'node:crypto';
import {
  fetchCollection,
  fetchDoc,
  getDigestDb,
  mergeDoc,
  removeDoc,
} from './firebaseDigestClient.mjs';
import { sendDigestEmail } from './mailer.mjs';

const SIGN_UP_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:signUp';
const SIGN_IN_URL =
  'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword';
const UPDATE_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:update';
const OOB_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode';

const REMIND_EVERY_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_REMINDERS = 5;
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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

function newSetPasswordToken() {
  return randomBytes(32).toString('base64url');
}

export function appLoginUrl() {
  return String(
    process.env.PORTAL_APP_URL ||
      process.env.URL ||
      process.env.DEPLOY_PRIME_URL ||
      'https://ignitetimetracker.netlify.app',
  ).replace(/\/$/, '');
}

function setPasswordUrl(token) {
  return `${appLoginUrl()}/set-password?token=${encodeURIComponent(token)}`;
}

async function ensureAuthUser(email, password) {
  const resp = await fetch(`${SIGN_UP_URL}?key=${encodeURIComponent(apiKey())}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      returnSecureToken: false,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (resp.ok) return { created: true };
  const msg = String(data?.error?.message || '');
  if (msg.includes('EMAIL_EXISTS')) return { created: false };
  throw new Error(msg || 'Could not create portal login.');
}

/** Legacy fallback when we cannot rotate the Auth password ourselves. */
async function sendFirebasePasswordReset(email) {
  const resp = await fetch(`${OOB_URL}?key=${encodeURIComponent(apiKey())}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestType: 'PASSWORD_RESET',
      email,
      continueUrl: appLoginUrl(),
      canHandleCodeInApp: false,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.error?.message || 'Could not send set-password email.');
  }
}

async function signInWithPassword(email, password) {
  const resp = await fetch(`${SIGN_IN_URL}?key=${encodeURIComponent(apiKey())}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      returnSecureToken: true,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.error?.message || 'Could not verify temporary login.');
  }
  return data;
}

async function updateAccountPassword(idToken, password) {
  const resp = await fetch(`${UPDATE_URL}?key=${encodeURIComponent(apiKey())}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idToken,
      password,
      returnSecureToken: true,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.error?.message || 'Could not set password.');
  }
  return data;
}

async function sendBrandedInviteEmail({
  to,
  clientName,
  setPasswordLink,
  isReminder = false,
  legacyFirebaseFallback = false,
}) {
  const loginUrl = appLoginUrl();
  const subject = isReminder
    ? `Reminder: set up your ${clientName} portal access`
    : `You're invited to the ${clientName} client portal`;

  if (legacyFirebaseFallback) {
    const text = [
      `Hi,`,
      '',
      `You've been invited to the Ignite PM client portal for ${clientName}.`,
      '',
      `Check your inbox for a Firebase email with a link to set your password, then sign in at ${loginUrl}.`,
      '',
      `If that link says it expired, use Forgot Password on the login page or ask Ignite to resend.`,
      '',
      `— Ignite PM`,
    ].join('\n');
    const html = `<html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a;line-height:1.5;padding:24px;">
  <div style="max-width:560px;margin:0 auto;">
    <div style="font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#fd7414;">Ignite PM · Client portal</div>
    <h1 style="font-size:20px;margin:8px 0 12px;">You are invited</h1>
    <p>Portal access for <strong>${String(clientName || '').replace(/</g, '')}</strong>.</p>
    <p>Open the <strong>Firebase set-password email</strong> in your inbox, then sign in at <a href="${loginUrl}">${loginUrl}</a>.</p>
  </div>
</body></html>`;
    try {
      await sendDigestEmail({ to, subject, text, html });
      return true;
    } catch (err) {
      console.warn('[portalInvite] branded email skipped:', err?.message || err);
      return false;
    }
  }

  const text = [
    `Hi,`,
    '',
    isReminder
      ? `This is a reminder to finish setting up your Ignite PM client portal access for ${clientName}.`
      : `You've been invited to the Ignite PM client portal for ${clientName}.`,
    '',
    `Set your password here (link valid for 7 days):`,
    setPasswordLink,
    '',
    `Then sign in at ${loginUrl} with this email (Google sign-in also works if you use Google with the same address).`,
    '',
    `— Ignite PM`,
  ].join('\n');
  const html = `<html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a;line-height:1.5;padding:24px;">
  <div style="max-width:560px;margin:0 auto;">
    <div style="font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#fd7414;">Ignite PM · Client portal</div>
    <h1 style="font-size:20px;margin:8px 0 12px;">${isReminder ? 'Reminder: set your password' : 'You are invited'}</h1>
    <p>Portal access for <strong>${String(clientName || '').replace(/</g, '')}</strong>.</p>
    <p style="margin:24px 0;">
      <a href="${setPasswordLink}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:14px 20px;border-radius:12px;font-size:12px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;">Set your password</a>
    </p>
    <p style="color:#64748b;font-size:13px;">This opens a secure page on our site. Your password is only saved when you submit the form — email scanners cannot use the link up.</p>
    <p style="color:#64748b;font-size:13px;">After that, sign in at <a href="${loginUrl}">${loginUrl}</a>.</p>
  </div>
</body></html>`;
  try {
    await sendDigestEmail({ to, subject, text, html });
    return true;
  } catch (err) {
    console.warn('[portalInvite] branded email skipped:', err?.message || err);
    return false;
  }
}

/**
 * Portal login queries array-contains with a lowercase email, and Firestore
 * matching is case-sensitive. Always persist clientEmails lowercased.
 */
async function normalizeClientEmailsOnDoc(db, clientId, { ensureEmail = null } = {}) {
  const cid = String(clientId || '').trim();
  if (!cid) return null;
  const client = await fetchDoc(db, `clients/${cid}`);
  if (!client) return null;
  const emails = Array.isArray(client.clientEmails) ? client.clientEmails : [];
  const lowered = [...new Set(emails.map(normEmail).filter(Boolean))];
  const ensure = normEmail(ensureEmail);
  if (ensure && !lowered.includes(ensure)) lowered.push(ensure);
  if (JSON.stringify(lowered) !== JSON.stringify(emails)) {
    await mergeDoc(db, `clients/${cid}`, { clientEmails: lowered });
    return { ...client, id: cid, clientEmails: lowered };
  }
  return { ...client, id: cid, clientEmails: emails };
}

/**
 * Self-heal for portal login: if an invite exists for this email, force
 * clientEmails onto lowercase (and ensure the invite email is listed) so the
 * client-side array-contains query can succeed.
 */
export async function syncPortalAccessForEmail(email) {
  const em = normEmail(email);
  if (!em) throw new Error('Missing email.');
  const db = await getDigestDb();
  const invite = await fetchDoc(db, `portalInvites/${em}`);
  if (!invite?.clientId) {
    return { ok: false, reason: 'no_invite', email: em };
  }
  if (String(invite.status || '').toLowerCase() === 'revoked') {
    return { ok: false, reason: 'revoked', email: em, clientId: invite.clientId };
  }
  const client = await normalizeClientEmailsOnDoc(db, invite.clientId, {
    ensureEmail: em,
  });
  if (!client) {
    return { ok: false, reason: 'client_missing', email: em, clientId: invite.clientId };
  }
  return {
    ok: true,
    email: em,
    clientId: client.id,
    clientName: client.name || '',
    clientEmails: client.clientEmails || [],
  };
}

async function assertEmailOnClientOnly(db, email, clientId) {
  const client = await normalizeClientEmailsOnDoc(db, clientId);
  if (!client) {
    throw new Error('Client not found.');
  }
  const onThis = (Array.isArray(client.clientEmails) ? client.clientEmails : [])
    .map(normEmail)
    .includes(email);
  if (!onThis) {
    throw new Error(
      'That email is not on this client’s authorized portal list. Add it under Authorized Emails and save first.',
    );
  }
  const clients = await fetchCollection(db, 'clients');
  const other = clients.find((c) => {
    if (!c || c.id === clientId) return false;
    const emails = Array.isArray(c.clientEmails) ? c.clientEmails : [];
    return emails.map(normEmail).includes(email);
  });
  if (other) {
    throw new Error(
      `That email is already authorized on “${other.name || other.id}”. Each email can only access one client.`,
    );
  }
  return client;
}

async function assertNotStaff(db, email) {
  const adminDoc = await fetchDoc(db, `admins/${email}`);
  if (adminDoc) {
    throw new Error(
      'That email belongs to a staff account. Staff use the internal app, not the client portal invite.',
    );
  }
}

async function issueSetPasswordToken(db, email, prevTokenId) {
  if (prevTokenId) {
    try {
      await removeDoc(db, `portalInviteTokens/${prevTokenId}`);
    } catch {
      /* ignore */
    }
  }
  const token = newSetPasswordToken();
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  await mergeDoc(db, `portalInviteTokens/${token}`, {
    email,
    expiresAt,
    createdAt: Date.now(),
  });
  return { token, expiresAt };
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

  const prev = (await fetchDoc(db, `portalInvites/${em}`)) || {};
  const existingSecret = await fetchDoc(db, `portalInviteSecrets/${em}`);
  let tempPassword = existingSecret?.tempPassword
    ? String(existingSecret.tempPassword)
    : '';
  let legacyFirebaseFallback = false;

  if (!tempPassword) {
    tempPassword = randomPassword();
    const authResult = await ensureAuthUser(em, tempPassword);
    if (!authResult.created) {
      // Legacy account (created before we stored temp passwords): Firebase reset fallback.
      await sendFirebasePasswordReset(em);
      legacyFirebaseFallback = true;
      tempPassword = '';
    } else {
      await mergeDoc(db, `portalInviteSecrets/${em}`, {
        email: em,
        tempPassword,
        updatedAt: Date.now(),
      });
    }
  }

  let token = null;
  let expiresAt = null;
  let link = appLoginUrl();
  if (!legacyFirebaseFallback) {
    const issued = await issueSetPasswordToken(
      db,
      em,
      prev.setPasswordTokenId || null,
    );
    token = issued.token;
    expiresAt = issued.expiresAt;
    link = setPasswordUrl(token);
  } else if (prev.setPasswordTokenId) {
    try {
      await removeDoc(db, `portalInviteTokens/${prev.setPasswordTokenId}`);
    } catch {
      /* ignore */
    }
  }

  await sendBrandedInviteEmail({
    to: em,
    clientName: client.name || 'your account',
    setPasswordLink: link,
    isReminder,
    legacyFirebaseFallback,
  });

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
    setPasswordTokenId: token,
    setPasswordTokenExpiresAt: expiresAt,
    authCreatedOnInvite: prev.authCreatedOnInvite || !legacyFirebaseFallback,
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

  try {
    const { writeClientActivity } = await import('./clientActivity.mjs');
    await writeClientActivity({
      clientId: cid,
      clientName: client.name || '',
      type: 'portal_invite',
      title: isReminder
        ? `Portal invite reminder: ${em}`
        : `Portal invite sent: ${em}`,
      body: isReminder
        ? 'Set-password reminder emailed.'
        : 'Invite with custom set-password link emailed.',
      actorEmail: invitedBy || 'system',
      source: 'system',
      meta: { email: em, reminded: !!isReminder },
    });
  } catch (err) {
    console.warn('[portalInvite] activity log skipped:', err?.message || err);
  }

  return {
    ok: true,
    email: em,
    clientId: cid,
    reminded: !!isReminder,
    legacyFirebaseFallback,
  };
}

/**
 * Validate a set-password token (does not consume it).
 */
export async function validateSetPasswordToken(token) {
  const raw = String(token || '').trim();
  if (!raw || raw.length < 20) {
    return { ok: false, error: 'Invalid or missing link. Ask Ignite to resend your invite.' };
  }
  const db = await getDigestDb();
  const row = await fetchDoc(db, `portalInviteTokens/${raw}`);
  if (!row?.email) {
    return { ok: false, error: 'This link is invalid or has already been used.' };
  }
  if (Number(row.expiresAt || 0) < Date.now()) {
    return { ok: false, error: 'This link has expired. Ask Ignite to resend your invite.' };
  }
  return { ok: true, email: normEmail(row.email) };
}

/**
 * Complete set-password: verify token, set Auth password, consume token.
 */
export async function completeSetPassword({ token, password } = {}) {
  const pwd = String(password || '');
  if (pwd.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
  const validated = await validateSetPasswordToken(token);
  if (!validated.ok) throw new Error(validated.error);

  const em = validated.email;
  const db = await getDigestDb();
  const secret = await fetchDoc(db, `portalInviteSecrets/${em}`);
  const tempPassword = String(secret?.tempPassword || '');
  if (!tempPassword) {
    throw new Error(
      'This invite needs a fresh link. Ask Ignite to resend your invite, or use Forgot Password on the login page.',
    );
  }

  const signedIn = await signInWithPassword(em, tempPassword);
  await updateAccountPassword(signedIn.idToken, pwd);

  const raw = String(token || '').trim();
  try {
    await removeDoc(db, `portalInviteTokens/${raw}`);
  } catch {
    /* ignore */
  }
  try {
    await removeDoc(db, `portalInviteSecrets/${em}`);
  } catch {
    /* ignore */
  }

  const invite = (await fetchDoc(db, `portalInvites/${em}`)) || {};
  await mergeDoc(db, `portalInvites/${em}`, {
    status: 'accepted',
    acceptedAt: Date.now(),
    setPasswordTokenId: null,
    setPasswordTokenExpiresAt: null,
    updatedAt: Date.now(),
  });

  // Re-normalize so the first login after set-password can array-contains match.
  if (invite.clientId) {
    try {
      await normalizeClientEmailsOnDoc(db, invite.clientId, { ensureEmail: em });
    } catch (err) {
      console.warn(
        '[portalInvite] clientEmails normalize skipped:',
        err?.message || err,
      );
    }
  }

  return { ok: true, email: em, loginUrl: appLoginUrl() };
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
  if (prev.setPasswordTokenId) {
    try {
      await removeDoc(db, `portalInviteTokens/${prev.setPasswordTokenId}`);
    } catch {
      /* ignore */
    }
  }
  try {
    await removeDoc(db, `portalInviteSecrets/${em}`);
  } catch {
    /* ignore */
  }
  await mergeDoc(db, `portalInvites/${em}`, {
    status: 'revoked',
    revokedAt: Date.now(),
    setPasswordTokenId: null,
    setPasswordTokenExpiresAt: null,
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

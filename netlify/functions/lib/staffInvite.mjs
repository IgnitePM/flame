/**
 * Invite-only staff accounts (email + password), same pattern as portal invites.
 *
 * Reuses portalInviteTokens / portalInviteSecrets / portalInvites (kind: 'staff')
 * so it works with existing Firestore rules — no new collections required.
 * The admin browser creates/updates admins/{email}; this function only handles
 * Auth + email + invite tracking (digest bot is billing and cannot write admins).
 */

import { randomBytes } from 'node:crypto';
import {
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

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ALLOWED_ROLES = new Set(['admin', 'billing', 'kiosk']);

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

function appLoginUrl() {
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

function normalizeRole(role) {
  const r = String(role || 'kiosk').trim().toLowerCase();
  return ALLOWED_ROLES.has(r) ? r : 'kiosk';
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
  throw new Error(msg || 'Could not create staff login.');
}

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

async function updateAccountProfile(idToken, { displayName } = {}) {
  const name = String(displayName || '').trim();
  if (!name || !idToken) return null;
  const resp = await fetch(`${UPDATE_URL}?key=${encodeURIComponent(apiKey())}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idToken,
      displayName: name,
      returnSecureToken: false,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.warn(
      '[staffInvite] displayName update:',
      data?.error?.message || resp.status,
    );
    return null;
  }
  return data;
}

async function assertNotClientPortalInvite(db, email) {
  const invite = await fetchDoc(db, `portalInvites/${email}`);
  if (!invite) return;
  const kind = String(invite.kind || 'portal').toLowerCase();
  const status = String(invite.status || '').toLowerCase();
  if (kind !== 'staff' && status !== 'revoked') {
    throw new Error(
      'That email has a client portal invite. Revoke the portal invite first, or use a different email.',
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
    kind: 'staff',
    expiresAt,
    createdAt: Date.now(),
  });
  return { token, expiresAt };
}

async function sendStaffInviteEmail({
  to,
  role,
  setPasswordLink,
  isReminder = false,
  legacyFirebaseFallback = false,
}) {
  const loginUrl = appLoginUrl();
  const roleLabel =
    role === 'admin' ? 'Admin' : role === 'billing' ? 'Billing' : 'Kiosk';
  const subject = isReminder
    ? 'Reminder: set up your Ignite PM workspace access'
    : "You're invited to Ignite PM TimeClock";

  if (legacyFirebaseFallback) {
    const text = [
      `Hi,`,
      '',
      `You've been invited to the Ignite PM staff workspace (${roleLabel}).`,
      '',
      `Check your inbox for a Firebase email with a link to set your password, then sign in at ${loginUrl} with email + password.`,
      '',
      `— Ignite PM`,
    ].join('\n');
    const html = `<html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a;line-height:1.5;padding:24px;">
  <div style="max-width:560px;margin:0 auto;">
    <div style="font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#fd7414;">Ignite PM · Staff workspace</div>
    <h1 style="font-size:20px;margin:8px 0 12px;">You are invited</h1>
    <p>Role: <strong>${roleLabel}</strong>.</p>
    <p>Open the <strong>Firebase set-password email</strong> in your inbox, then sign in at <a href="${loginUrl}">${loginUrl}</a>.</p>
  </div>
</body></html>`;
    await sendDigestEmail({ to, subject, text, html });
    return true;
  }

  const text = [
    `Hi,`,
    '',
    isReminder
      ? `This is a reminder to finish setting up your Ignite PM staff workspace access (${roleLabel}).`
      : `You've been invited to the Ignite PM staff workspace as ${roleLabel}.`,
    '',
    `Set your password here (link valid for 7 days):`,
    setPasswordLink,
    '',
    `Then sign in at ${loginUrl} with this email and password. Google sign-in also works if you use Google with the same address.`,
    '',
    `— Ignite PM`,
  ].join('\n');
  const html = `<html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a;line-height:1.5;padding:24px;">
  <div style="max-width:560px;margin:0 auto;">
    <div style="font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#fd7414;">Ignite PM · Staff workspace</div>
    <h1 style="font-size:20px;margin:8px 0 12px;">${isReminder ? 'Reminder: set your password' : 'You are invited'}</h1>
    <p>Role: <strong>${roleLabel}</strong>.</p>
    <p style="margin:24px 0;">
      <a href="${setPasswordLink}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:14px 20px;border-radius:12px;font-size:12px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;">Set your password</a>
    </p>
    <p style="color:#64748b;font-size:13px;">This opens a secure page on our site. Your password is only saved when you submit the form — email scanners cannot use the link up.</p>
    <p style="color:#64748b;font-size:13px;">After that, sign in at <a href="${loginUrl}">${loginUrl}</a> with email + password.</p>
  </div>
</body></html>`;
  await sendDigestEmail({ to, subject, text, html });
  return true;
}

/**
 * @param {{ email: string, role?: string, invitedBy: string, isReminder?: boolean, displayName?: string, forceNewPassword?: boolean }} args
 */
export async function inviteStaffUser({
  email,
  role = 'kiosk',
  invitedBy,
  isReminder = false,
  displayName = '',
  forceNewPassword = false,
} = {}) {
  const em = normEmail(email);
  const nextRole = normalizeRole(role);
  const name = String(displayName || '').trim();
  if (!em || !em.includes('@')) throw new Error('Enter a valid email address.');

  const db = await getDigestDb();
  await assertNotClientPortalInvite(db, em);

  // Admins doc must already exist (created by the admin browser). Billing bot
  // cannot create/update admins/{email} under current Firestore rules.
  const existingAdmin = await fetchDoc(db, `admins/${em}`);
  if (!existingAdmin) {
    throw new Error(
      'Staff user record is missing. Save the user in Users first, then send the invite again.',
    );
  }

  const prev = (await fetchDoc(db, `portalInvites/${em}`)) || {};
  if (forceNewPassword) {
    try {
      await removeDoc(db, `portalInviteSecrets/${em}`);
    } catch {
      /* ignore */
    }
  }
  const existingSecret = forceNewPassword
    ? null
    : await fetchDoc(db, `portalInviteSecrets/${em}`);
  let tempPassword = existingSecret?.tempPassword
    ? String(existingSecret.tempPassword)
    : '';
  let legacyFirebaseFallback = false;

  if (!tempPassword) {
    tempPassword = randomPassword();
    const authResult = await ensureAuthUser(em, tempPassword);
    if (!authResult.created) {
      await sendFirebasePasswordReset(em);
      legacyFirebaseFallback = true;
      tempPassword = '';
    } else {
      await mergeDoc(db, `portalInviteSecrets/${em}`, {
        email: em,
        kind: 'staff',
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
      prev.kind === 'staff' ? prev.setPasswordTokenId || null : null,
    );
    token = issued.token;
    expiresAt = issued.expiresAt;
    link = setPasswordUrl(token);
  } else if (prev.kind === 'staff' && prev.setPasswordTokenId) {
    try {
      await removeDoc(db, `portalInviteTokens/${prev.setPasswordTokenId}`);
    } catch {
      /* ignore */
    }
  }

  await sendStaffInviteEmail({
    to: em,
    role: nextRole,
    setPasswordLink: link,
    isReminder,
    legacyFirebaseFallback,
  });

  const now = Date.now();
  await mergeDoc(db, `portalInvites/${em}`, {
    email: em,
    kind: 'staff',
    role: nextRole,
    clientId: null,
    clientName: '',
    status: 'pending',
    invitedAt: prev.kind === 'staff' ? prev.invitedAt || now : now,
    invitedBy: invitedBy || (prev.kind === 'staff' ? prev.invitedBy : '') || '',
    lastInvitedAt: now,
    lastRemindedAt: isReminder ? now : prev.lastRemindedAt || null,
    remindCount: isReminder
      ? Number(prev.remindCount || 0) + 1
      : Number(prev.remindCount || 0),
    setPasswordTokenId: token,
    setPasswordTokenExpiresAt: expiresAt,
    authCreatedOnInvite:
      (prev.kind === 'staff' && prev.authCreatedOnInvite) || !legacyFirebaseFallback,
    displayName: name || prev.displayName || existingAdmin.displayName || '',
    updatedAt: now,
  });

  return {
    ok: true,
    email: em,
    role: nextRole,
    reminded: !!isReminder,
    legacyFirebaseFallback,
  };
}

export async function markStaffInviteRevoked(email) {
  const em = normEmail(email);
  if (!em) throw new Error('Missing email.');
  const db = await getDigestDb();
  const prev = (await fetchDoc(db, `portalInvites/${em}`)) || {};
  if (String(prev.kind || '') !== 'staff') {
    return { ok: true, email: em, skipped: 'not_staff_invite' };
  }
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
    email: em,
    kind: 'staff',
    status: 'revoked',
    setPasswordTokenId: null,
    setPasswordTokenExpiresAt: null,
    updatedAt: Date.now(),
  });
  return { ok: true, email: em };
}

export async function validateStaffSetPasswordToken(token) {
  const raw = String(token || '').trim();
  if (!raw || raw.length < 20) {
    return {
      ok: false,
      error: 'Invalid or missing link. Ask your admin to resend your invite.',
    };
  }
  const db = await getDigestDb();
  const row = await fetchDoc(db, `portalInviteTokens/${raw}`);
  if (!row?.email) {
    return { ok: false, error: 'This link is invalid or has already been used.' };
  }
  if (String(row.kind || '') !== 'staff') {
    return { ok: false, error: 'This link is invalid or has already been used.' };
  }
  if (Number(row.expiresAt || 0) < Date.now()) {
    return {
      ok: false,
      error: 'This link has expired. Ask your admin to resend your invite.',
    };
  }
  return { ok: true, email: normEmail(row.email), kind: 'staff' };
}

export async function completeStaffSetPassword({ token, password, profile } = {}) {
  const pwd = String(password || '');
  if (pwd.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
  const name = String(profile?.name || profile?.displayName || '').trim();
  if (!name) {
    throw new Error('Please enter your name.');
  }
  const validated = await validateStaffSetPasswordToken(token);
  if (!validated.ok) throw new Error(validated.error);

  const em = validated.email;
  const db = await getDigestDb();
  const secret = await fetchDoc(db, `portalInviteSecrets/${em}`);
  if (String(secret?.kind || '') !== 'staff' && secret?.tempPassword) {
    // Allow secrets written before kind was stamped.
  }
  const tempPassword = String(secret?.tempPassword || '');
  if (!tempPassword) {
    throw new Error(
      'This invite needs a fresh link. Ask your admin to resend the invite, or use Forgot Password on the login page.',
    );
  }

  const signedIn = await signInWithPassword(em, tempPassword);
  await updateAccountPassword(signedIn.idToken, pwd);
  await updateAccountProfile(signedIn.idToken, { displayName: name });

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
  const now = Date.now();
  await mergeDoc(db, `portalInvites/${em}`, {
    kind: 'staff',
    status: 'accepted',
    acceptedAt: invite.acceptedAt || now,
    passwordSetAt: now,
    displayName: name,
    setPasswordTokenId: null,
    setPasswordTokenExpiresAt: null,
    updatedAt: now,
  });

  return { ok: true, email: em, loginUrl: appLoginUrl(), kind: 'staff' };
}

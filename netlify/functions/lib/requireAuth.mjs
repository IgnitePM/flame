/**
 * Caller verification for the HTTP Netlify functions.
 *
 * Verifies a Firebase ID token through the Identity Toolkit REST API rather
 * than firebase-admin, because this project cannot mint service-account keys
 * (same constraint that shaped firebaseDigestClient.mjs). Role lookups reuse
 * the digest bot's Firestore session, which already has read access to the
 * admins collection under firestore.rules' isAnyStaff().
 */

const LOOKUP_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup';
const STAFF_DOMAIN = '@ignitepm.com';

// Mirrors the bootstrap anchor in firestore.rules and src/App.jsx: this account
// is always treated as admin so a stale admins doc can't lock the owner out.
const OWNER_EMAIL = 'chris@ignitepm.com';

export class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

/** Handles both the Lambda-style `event.headers` object and Web `Request.headers`. */
function bearerToken(headers) {
  const raw =
    typeof headers?.get === 'function'
      ? headers.get('authorization')
      : headers?.authorization || headers?.Authorization;
  const match = /^Bearer\s+(.+)$/i.exec(String(raw || '').trim());
  return match ? match[1] : '';
}

export async function verifyIdToken(headers) {
  const idToken = bearerToken(headers);
  if (!idToken) throw new AuthError(401, 'Sign in required.');

  const apiKey = process.env.VITE_FIREBASE_API_KEY;
  if (!apiKey) {
    console.error('[requireAuth] VITE_FIREBASE_API_KEY is not scoped to Functions.');
    throw new AuthError(500, 'Server misconfigured.');
  }

  const resp = await fetch(`${LOOKUP_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  if (!resp.ok) throw new AuthError(401, 'Session expired — sign in again.');

  const data = await resp.json().catch(() => ({}));
  const account = Array.isArray(data.users) ? data.users[0] : null;
  const email = String(account?.email || '').trim().toLowerCase();
  if (!email) throw new AuthError(401, 'Sign in required.');

  return { uid: account.localId, email };
}

/**
 * Role string from admins/{email}. Returns '' when no doc exists and null when
 * the lookup itself could not run, so callers can tell "not staff" apart from
 * "could not check".
 */
async function lookupRole(email) {
  try {
    const { getDigestDb, fetchDoc } = await import('./firebaseDigestClient.mjs');
    const db = await getDigestDb();
    const adminDoc = await fetchDoc(db, `admins/${email}`);
    return typeof adminDoc?.role === 'string' ? adminDoc.role : '';
  } catch (err) {
    console.error('[requireAuth] role lookup failed:', err?.message || err);
    return null;
  }
}

/**
 * Requires a signed-in staff caller.
 *
 * An @ignitepm.com address is sufficient on its own so AI features keep working
 * if the role lookup is briefly unavailable; anyone else needs an
 * admins/{email} doc. Pass `roles` to additionally require one of a set of
 * roles, in which case the lookup is mandatory and a failure denies.
 */
export async function requireStaffCaller(headers, { roles = null } = {}) {
  const caller = await verifyIdToken(headers);
  const isStaffDomain = caller.email.endsWith(STAFF_DOMAIN);
  const looked = await lookupRole(caller.email);
  const role = caller.email === OWNER_EMAIL ? 'admin' : looked;

  if (roles) {
    if (role === null) {
      throw new AuthError(503, 'Could not verify your permissions. Try again.');
    }
    if (!roles.includes(role)) {
      throw new AuthError(403, 'You do not have permission to do this.');
    }
  } else if (!isStaffDomain && !role) {
    throw new AuthError(403, 'Your account is not registered as staff.');
  }

  return { ...caller, role: role || '', isStaffDomain };
}

export function describeAuthError(err) {
  if (err instanceof AuthError) return { status: err.status, message: err.message };
  console.error('[requireAuth] unexpected:', err);
  return { status: 500, message: 'Authentication failed.' };
}

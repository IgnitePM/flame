/**
 * Firestore access for the digest functions using the regular Firebase
 * *client* SDK (same package the frontend uses) signed in as a dedicated
 * "digest bot" account — instead of firebase-admin + a service account key.
 *
 * Many orgs disable service-account key creation entirely
 * (iam.disableServiceAccountKeyCreation), which blocks the Admin SDK
 * approach no matter who requests the key. Signing in as a normal Firebase
 * Auth user and reading through existing Firestore security rules avoids
 * that restriction completely.
 *
 * Setup (no gcloud/IAM access needed):
 *   1. Firebase Console → Authentication → Sign-in method → enable
 *      Email/Password (if not already).
 *   2. Firebase Console → Authentication → Users → Add user → create an
 *      account (e.g. digest-bot@ignitepm.com) with a strong password.
 *   3. Firebase Console → Firestore Database → admins collection → Add
 *      document, with the document ID set to that email, lowercased, and
 *      fields { email: "<same email>", role: "billing" }. This is what
 *      firestore.rules' isAnyStaff()/isBilling() check for read access.
 *   4. In Netlify env vars, set DIGEST_BOT_EMAIL / DIGEST_BOT_PASSWORD to
 *      that account's credentials, and make sure the existing
 *      VITE_FIREBASE_* variables are scoped to "Functions" too (not just
 *      Builds), since this reuses the same Firebase project config.
 */

import { getApps, initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, getFirestore, query, setDoc, where } from 'firebase/firestore';

function getFirebaseConfig() {
  const config = {
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.VITE_FIREBASE_APP_ID,
  };
  if (!config.apiKey || !config.projectId) {
    throw new Error(
      'Missing VITE_FIREBASE_* environment variables in the Functions scope (needed for the digest bot to sign in).',
    );
  }
  return config;
}

let dbPromise = null;

async function signInAndGetDb() {
  const email = process.env.DIGEST_BOT_EMAIL;
  const password = process.env.DIGEST_BOT_PASSWORD;
  if (!email || !password) {
    throw new Error('Missing DIGEST_BOT_EMAIL or DIGEST_BOT_PASSWORD environment variables.');
  }
  const app = getApps()[0] || initializeApp(getFirebaseConfig());
  const auth = getAuth(app);
  await signInWithEmailAndPassword(auth, email, password);
  return getFirestore(app);
}

/** Cached across warm invocations of the same function instance. */
export function getDigestDb() {
  if (!dbPromise) dbPromise = signInAndGetDb();
  return dbPromise;
}

/**
 * Fetch a whole collection (optionally filtered) as plain objects with `id`.
 * `where` entries are [field, op, value] triples, same shape used throughout
 * src/App.jsx's onSnapshot/where() calls.
 */
export async function fetchCollection(db, name, { where: whereClauses = [] } = {}) {
  const ref = whereClauses.length
    ? query(collection(db, name), ...whereClauses.map(([field, op, value]) => where(field, op, value)))
    : collection(db, name);
  const snap = await getDocs(ref);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Fetch a single document by full path, e.g. 'settings/notifications'. */
export async function fetchDoc(db, path) {
  const snap = await getDoc(doc(db, path));
  return snap.exists() ? snap.data() : null;
}

/** Merge-write a document by full path (e.g. digest cursor). */
export async function mergeDoc(db, path, data) {
  await setDoc(doc(db, path), data, { merge: true });
}

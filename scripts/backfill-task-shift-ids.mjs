#!/usr/bin/env node
/**
 * Backfill taskLogs.shiftId using time containment + nearest-shift fallback.
 *
 * Dry-run by default (prints planned writes, changes nothing).
 * Pass --apply to write. Requires VITE_FIREBASE_* env vars and an authed
 * session is NOT used — this uses the client SDK with a service login via
 * FIREBASE_MIGRATION_EMAIL / FIREBASE_MIGRATION_PASSWORD (admin user).
 *
 * Usage:
 *   node scripts/backfill-task-shift-ids.mjs
 *   node scripts/backfill-task-shift-ids.mjs --apply
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  updateDoc,
} from 'firebase/firestore';
import { planShiftIdBackfill } from '../src/utils/shiftTaskAssociation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function loadEnvFile(name) {
  const path = resolve(root, name);
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile('.env');
loadEnvFile('.env.local');

const apply = process.argv.includes('--apply');
const dryRun = !apply;

function requireEnv(key) {
  const v = process.env[key];
  if (!v) {
    console.error(`Missing env ${key}. Set it in .env.local or the shell.`);
    process.exit(1);
  }
  return v;
}

const firebaseConfig = {
  apiKey: requireEnv('VITE_FIREBASE_API_KEY'),
  authDomain: requireEnv('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: requireEnv('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: requireEnv('VITE_FIREBASE_APP_ID'),
};

const email = process.env.FIREBASE_MIGRATION_EMAIL;
const password = process.env.FIREBASE_MIGRATION_PASSWORD;
if (!email || !password) {
  console.error(
    'Set FIREBASE_MIGRATION_EMAIL and FIREBASE_MIGRATION_PASSWORD (admin account) to read/write Firestore.',
  );
  process.exit(1);
}

async function main() {
  console.log(
    dryRun
      ? '=== DRY RUN (no writes). Pass --apply to commit. ==='
      : '=== APPLY MODE — writing shiftId updates ===',
  );

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  await signInWithEmailAndPassword(auth, email, password);
  console.log(`Signed in as ${email}`);

  const [taskSnap, shiftSnap] = await Promise.all([
    getDocs(collection(db, 'taskLogs')),
    getDocs(collection(db, 'timesheets')),
  ]);

  const taskLogs = taskSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const timesheets = shiftSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  console.log(`Loaded ${taskLogs.length} tasks, ${timesheets.length} shifts`);

  const plan = planShiftIdBackfill(taskLogs, timesheets);
  console.log(`Planned updates: ${plan.length}`);

  for (const row of plan) {
    console.log(
      JSON.stringify({
        taskId: row.taskId,
        from: row.from,
        to: row.to,
        method: row.method,
        candidates: row.candidates,
        employeeName: row.employeeName,
        clientName: row.clientName,
        clockInTime: row.clockInTime,
        clockOutTime: row.clockOutTime,
      }),
    );
  }

  if (dryRun) {
    console.log(
      `\nDry run complete. Re-run with --apply to write ${plan.length} update(s).`,
    );
    process.exit(0);
  }

  let written = 0;
  for (const row of plan) {
    await updateDoc(doc(db, 'taskLogs', row.taskId), {
      shiftId: row.to,
      shiftIdBackfilledAt: Date.now(),
      shiftIdBackfillMethod: row.method,
    });
    written += 1;
  }
  console.log(`Wrote ${written} taskLogs.shiftId update(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Move open todos from legacy UTC-midnight billing cycle keys to the matching
 * America/Toronto-midnight keys.
 *
 * Dry-run by default (prints planned moves, changes nothing).
 * Pass --apply to write. Auth: DIGEST_BOT_EMAIL/PASSWORD (preferred) or
 * FIREBASE_MIGRATION_EMAIL/PASSWORD, plus VITE_FIREBASE_* config.
 *
 * Usage:
 *   node scripts/migrate-utc-todo-cycle-keys.mjs
 *   node scripts/migrate-utc-todo-cycle-keys.mjs --apply
 */

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { planUtcTodoCycleKeyMigration } from '../src/utils/migrateUtcTodoCycleKeys.js';

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

const email =
  process.env.DIGEST_BOT_EMAIL || process.env.FIREBASE_MIGRATION_EMAIL;
const password =
  process.env.DIGEST_BOT_PASSWORD || process.env.FIREBASE_MIGRATION_PASSWORD;
if (!email || !password) {
  console.error(
    'Set DIGEST_BOT_EMAIL/DIGEST_BOT_PASSWORD (or FIREBASE_MIGRATION_EMAIL/PASSWORD) to read/write Firestore.',
  );
  process.exit(1);
}

async function main() {
  console.log(
    dryRun
      ? '=== DRY RUN (no writes). Pass --apply to commit. ==='
      : '=== APPLY MODE — writing todoCycles updates ===',
  );

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  await signInWithEmailAndPassword(auth, email, password);
  console.log(`Signed in as ${email}`);

  const snap = await getDocs(collection(db, 'clients'));
  const clients = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  console.log(`Loaded ${clients.length} clients`);

  const plan = planUtcTodoCycleKeyMigration(clients);
  console.log(
    JSON.stringify(
      {
        moveCount: plan.moves.length,
        clientsToPatch: plan.patches.length,
        skippedCompleted: plan.skippedCompleted,
        skippedNonLegacyCycleKeys: plan.skippedNonLegacyCycleKeys,
      },
      null,
      2,
    ),
  );

  const outPath = resolve(
    root,
    apply
      ? 'migrate-utc-todo-cycle-keys.apply.json'
      : 'migrate-utc-todo-cycle-keys.dry-run.json',
  );
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        mode: apply ? 'apply' : 'dry-run',
        summary: {
          moveCount: plan.moves.length,
          clientsToPatch: plan.patches.length,
          skippedCompleted: plan.skippedCompleted,
          skippedNonLegacyCycleKeys: plan.skippedNonLegacyCycleKeys,
        },
        moves: plan.moves,
      },
      null,
      2,
    ),
  );
  console.log(`Wrote report: ${outPath}`);

  for (const row of plan.moves) {
    console.log(JSON.stringify(row));
  }

  if (dryRun) {
    console.log(
      `\nDry run complete. Re-run with --apply to write ${plan.patches.length} client update(s) (${plan.moves.length} open todo move(s)).`,
    );
    process.exit(0);
  }

  let written = 0;
  for (const patch of plan.patches) {
    await updateDoc(doc(db, 'clients', patch.clientId), {
      todoCycles: patch.todoCycles,
      utcTodoCycleKeyMigratedAt: Date.now(),
    });
    written += 1;
    console.log(
      `Patched ${patch.clientId} (${patch.clientName}) moves=${patch.moveCount}`,
    );
  }
  console.log(`Wrote ${written} client todoCycles update(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

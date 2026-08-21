import { runWorkspaceDigest, summarizeRun } from './lib/runDigest.mjs';

export default async () => {
  try {
    const result = await runWorkspaceDigest('weekly');
    console.log('[send-weekly-digest]', summarizeRun(result));
  } catch (err) {
    console.error('[send-weekly-digest] failed:', err);
  }
};

// See send-daily-digest.mjs for the UTC/DST caveat. Runs Monday 12:00 UTC
// (≈ 8:00 AM America/Toronto during EDT).
export const config = { schedule: '0 12 * * 1' };

import { runWorkspaceDigest } from './lib/runDigest.mjs';

export default async () => {
  try {
    const result = await runWorkspaceDigest('daily');
    console.log('[send-daily-digest]', result);
  } catch (err) {
    console.error('[send-daily-digest] failed:', err);
  }
};

// Netlify scheduled functions run on a fixed UTC cron and do NOT auto-adjust
// for daylight saving time. 12:00 UTC ≈ 8:00 AM America/Toronto (EDT) or
// 7:00 AM (EST). Adjust to taste, or nudge by an hour twice a year.
// Weekdays only (Mon–Fri): "0 12 * * 1-5".
export const config = { schedule: '0 12 * * 1-5' };

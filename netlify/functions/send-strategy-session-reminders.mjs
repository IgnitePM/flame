import { runStrategySessionReminders } from './lib/runStrategySessionReminders.mjs';

/**
 * Monthly Strategy & Review booking reminders for active clients.
 * Scheduled daily; the runner only sends on the 1st (America/Toronto)
 * unless already stamped for that month.
 */
export default async () => {
  try {
    const result = await runStrategySessionReminders();
    console.log('[send-strategy-session-reminders]', JSON.stringify(result));
  } catch (err) {
    console.error('[send-strategy-session-reminders] failed:', err);
    throw err;
  }
};

// Daily ~9am Eastern (13:00 UTC). Runner gates on Toronto calendar day === 1.
export const config = { schedule: '0 13 * * *' };

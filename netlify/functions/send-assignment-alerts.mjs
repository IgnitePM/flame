import { runAssignmentAlerts } from './lib/runDigest.mjs';

/**
 * Short assignment-only emails when staff receive new task assignments.
 * Runs often; only sends if there is something new since the last watermark.
 */
export default async () => {
  try {
    const result = await runAssignmentAlerts();
    console.log('[send-assignment-alerts]', result);
  } catch (err) {
    console.error('[send-assignment-alerts] failed:', err);
    throw err;
  }
};

// Every 15 minutes. Only emails users with new TASK_ASSIGNED notifications.
export const config = { schedule: '*/15 * * * *' };

import { runPortalInviteReminders } from './lib/portalInvite.mjs';

/**
 * Auto-remind pending portal invites every few days (capped).
 * Scheduled daily; the library skips invites that were reminded too recently.
 */
export default async () => {
  try {
    const result = await runPortalInviteReminders();
    console.log('[send-portal-invite-reminders]', JSON.stringify(result));
  } catch (err) {
    console.error('[send-portal-invite-reminders] failed:', err);
    throw err;
  }
};

// Daily at 14:00 UTC (~10am Eastern).
export const config = { schedule: '0 14 * * *' };

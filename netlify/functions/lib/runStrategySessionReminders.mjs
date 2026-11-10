/**
 * Monthly Strategy & Review booking reminders for active clients.
 * Writes a portal message + emails clientEmails with portal + direct booking CTAs.
 */

import { isClientActiveForWork } from '../../../src/utils/clientActiveForWork.js';
import {
  buildStrategyReminderMessageBody,
  isTorontoFirstOfMonth,
  resolveStrategyBookingUrl,
  strategyReminderMonthKey,
  strategyReminderMonthLabel,
} from '../../../src/utils/strategySessionBooking.js';
import {
  appBaseUrl,
  createMessageDoc,
  notifyStrategySessionReminder,
} from './clientMessaging.mjs';
import {
  fetchCollection,
  fetchDoc,
  getDigestDb,
  mergeDoc,
} from './firebaseDigestClient.mjs';

const SYSTEM_EMAIL = 'system:strategy-session-reminder';
const CURSOR_FIELD = 'strategySessionReminderMonthKey';
const SEND_GAP_MS = 350;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clientPortalEmails(client) {
  return [
    ...new Set(
      (Array.isArray(client?.clientEmails) ? client.clientEmails : [])
        .map((e) => String(e || '').trim().toLowerCase())
        .filter((e) => e.includes('@')),
    ),
  ];
}

async function loadNotifySettings(db) {
  return (await fetchDoc(db, 'settings/notifications')) || {};
}

/**
 * @param {{ force?: boolean, now?: Date, dryRun?: boolean }} [opts]
 */
export async function runStrategySessionReminders(opts = {}) {
  const force = opts.force === true;
  const dryRun = opts.dryRun === true;
  const now = opts.now instanceof Date ? opts.now : new Date();
  const monthKey = strategyReminderMonthKey(now);
  const monthLabel = strategyReminderMonthLabel(now);

  const db = await getDigestDb();
  const settings = await loadNotifySettings(db);

  if (settings.strategySessionRemindersEnabled === false) {
    return {
      skipped: true,
      reason: 'Strategy session reminders are disabled in settings/notifications.',
      monthKey,
    };
  }

  if (!force && !isTorontoFirstOfMonth(now)) {
    return {
      skipped: true,
      reason: 'Not the 1st of the month in America/Toronto.',
      monthKey,
    };
  }

  const cursor = (await fetchDoc(db, 'settings/digestCursor')) || {};
  if (!force && cursor[CURSOR_FIELD] === monthKey) {
    return {
      skipped: true,
      reason: `Already sent for ${monthKey}.`,
      monthKey,
    };
  }

  const bookingUrl = resolveStrategyBookingUrl(settings);
  const portalHref = `${appBaseUrl()}?tab=dashboard`;
  const clients = await fetchCollection(db, 'clients');

  const eligible = (clients || []).filter((c) => {
    if (!isClientActiveForWork(c)) return false;
    return clientPortalEmails(c).length > 0;
  });

  const results = {
    monthKey,
    monthLabel,
    bookingUrl,
    portalHref,
    considered: (clients || []).length,
    eligible: eligible.length,
    messaged: 0,
    emailed: 0,
    emailRecipients: 0,
    skippedNoEmail: 0,
    errors: [],
    dryRun,
  };

  for (const client of eligible) {
    const emails = clientPortalEmails(client);
    if (!emails.length) {
      results.skippedNoEmail += 1;
      continue;
    }
    const body = buildStrategyReminderMessageBody({
      clientName: client.name || '',
      monthLabel,
      bookingUrl,
    });

    if (dryRun) {
      results.messaged += 1;
      results.emailed += 1;
      results.emailRecipients += emails.length;
      continue;
    }

    try {
      await createMessageDoc({
        clientId: client.id,
        body,
        authorType: 'staff',
        authorEmail: SYSTEM_EMAIL,
        authorName: 'Ignite PM',
        attachments: [],
        createdAt: now.getTime(),
        systemKind: 'strategy_session_reminder',
        meta: {
          monthKey,
          bookingUrl,
        },
      });
      results.messaged += 1;
    } catch (err) {
      results.errors.push({
        clientId: client.id,
        stage: 'message',
        error: err?.message || String(err),
      });
      continue;
    }

    try {
      const sent = await notifyStrategySessionReminder({
        client,
        monthLabel,
        bookingUrl,
        portalHref,
        messageBody: body,
      });
      if (sent?.sent > 0) {
        results.emailed += 1;
        results.emailRecipients += sent.sent;
      } else if (sent?.skipped) {
        results.skippedNoEmail += 1;
      }
    } catch (err) {
      results.errors.push({
        clientId: client.id,
        stage: 'email',
        error: err?.message || String(err),
      });
    }

    await sleep(SEND_GAP_MS);
  }

  if (!dryRun && results.errors.length === 0) {
    await mergeDoc(db, 'settings/digestCursor', {
      [CURSOR_FIELD]: monthKey,
      strategySessionReminderLastRunAt: Date.now(),
    });
  } else if (!dryRun && results.messaged > 0) {
    // Partial success still stamps the month so we don't double-spam; errors
    // stay in the result for the admin "Send now" response.
    await mergeDoc(db, 'settings/digestCursor', {
      [CURSOR_FIELD]: monthKey,
      strategySessionReminderLastRunAt: Date.now(),
      strategySessionReminderLastErrorCount: results.errors.length,
    });
  }

  return results;
}

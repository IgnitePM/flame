import { fetchCollection, getDigestDb, mergeDoc } from './lib/firebaseDigestClient.mjs';
import { notifyClientSlack } from './lib/clientSlack.mjs';

/**
 * Daily: post overdue open to-dos to each client's Slack webhook (if set).
 * Dedupes with clients/{id}.lastOverdueSlackAt so we don't spam every day
 * for the same quiet clients — only when there is at least one overdue item.
 */
export default async () => {
  const db = await getDigestDb();
  const clients = await fetchCollection(db, 'clients');
  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayMs = startOfToday.getTime();

  let posted = 0;
  const details = [];

  for (const client of clients || []) {
    const webhook = String(client.slackWebhookUrl || '').trim();
    if (!webhook || client.archived) continue;

    const overdue = [];
    const cycles = client.todoCycles || {};
    for (const cycleData of Object.values(cycles)) {
      if (!cycleData || typeof cycleData !== 'object') continue;
      for (const catTodo of Object.values(cycleData)) {
        const items = Array.isArray(catTodo?.items) ? catTodo.items : [];
        for (const item of items) {
          if (!item || item.done) continue;
          const due = Number(item.dueDate || 0);
          if (!due || due >= todayMs) continue;
          overdue.push(String(item.text || 'Untitled task').slice(0, 80));
        }
      }
    }

    if (!overdue.length) continue;

    // At most once per calendar day per client.
    const last = Number(client.lastOverdueSlackAt || 0);
    if (last >= todayMs) {
      details.push({ clientId: client.id, skipped: 'already_today' });
      continue;
    }

    const preview = overdue.slice(0, 8).map((t) => `• ${t}`).join('\n');
    const more =
      overdue.length > 8 ? `\n_…and ${overdue.length - 8} more_` : '';
    try {
      await notifyClientSlack({
        clientId: client.id,
        alsoGlobal: false,
        text:
          `:warning: *${overdue.length} overdue task${overdue.length === 1 ? '' : 's'}* for *${client.name || 'client'}*\n` +
          preview +
          more,
      });
      await mergeDoc(db, `clients/${client.id}`, { lastOverdueSlackAt: now });
      posted += 1;
      details.push({ clientId: client.id, overdue: overdue.length });
    } catch (err) {
      details.push({
        clientId: client.id,
        error: err?.message || String(err),
      });
    }
  }

  console.log(
    '[send-client-overdue-slack]',
    JSON.stringify({ posted, checked: clients?.length || 0, details }),
  );
};

// Weekdays 13:00 UTC (~9am Eastern).
export const config = { schedule: '0 13 * * 1-5' };

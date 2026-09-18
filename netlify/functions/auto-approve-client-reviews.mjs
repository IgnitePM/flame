import { getBillingPeriod } from '../../src/utils/billingEngine.js';
import {
  applyTodoApprovalDecision,
  isTodoReadyForAutoApprove,
} from '../../src/utils/todoApproval.js';
import {
  markPrimaryTodoDoneAcrossCycles,
  reconcileRecurringTodoInstances,
  recurringAnchorKey,
} from '../../src/utils/recurringTodoMaterialize.js';
import {
  createMessageDoc,
  getDigestDb,
  mergeDoc,
  notifyStaffTodoApprovalDecision,
  writeClientActivity,
  writeStaffInboxNotifications,
  collectClientStaffNotifyEmails,
} from './lib/clientMessaging.mjs';
import { fetchCollection } from './lib/firebaseDigestClient.mjs';

/**
 * Daily: auto-approve client review tasks past their reviewDeadline
 * when approvalAutoApprove is set.
 *
 * Schedule: 15:00 UTC weekdays (~11am ET).
 */
export const config = { schedule: '0 15 * * 1-5' };

const SYSTEM_EMAIL = 'system:auto-approve';

async function autoApproveOne({
  db,
  client,
  cycleStart,
  categoryKey,
  item,
  now,
}) {
  const cycleKey = String(cycleStart);
  let cycles = { ...(client.todoCycles || {}) };
  const cycleData = { ...(cycles[cycleKey] || {}) };
  const catTodo = cycleData[categoryKey] || { closed: false, items: [] };
  const items = Array.isArray(catTodo.items) ? [...catTodo.items] : [];
  const idx = items.findIndex((i) => i?.id === item.id);
  if (idx < 0) return { ok: false, reason: 'missing' };
  const current = items[idx];
  if (!isTodoReadyForAutoApprove(current, now)) {
    return { ok: false, reason: 'not_ready' };
  }

  const period = getBillingPeriod(client.billingDay || 1, 0);
  let nextItem = applyTodoApprovalDecision(current, {
    decision: 'approved',
    note: 'Auto-approved: client review deadline passed with no response.',
    byEmail: SYSTEM_EMAIL,
    now,
    autoApproved: true,
  });

  items[idx] = nextItem;
  cycleData[categoryKey] = { ...catTodo, items };
  cycles[cycleKey] = cycleData;

  let recurringSkipKey = '';
  if (current.recurring) {
    recurringSkipKey = recurringAnchorKey(
      current.recurringId || current.id,
      current.dueDate,
    );
  }
  const { cycles: markedCycles, touched } = markPrimaryTodoDoneAcrossCycles(
    cycles,
    categoryKey,
    current.id,
    true,
    { recurringSkipKey },
  );
  if (touched) cycles = markedCycles;

  if (String(cycleStart) === String(period.start)) {
    const slice = cycles[String(period.start)];
    const { cycleDataByCategory, changed } = reconcileRecurringTodoInstances(
      slice,
      period.start,
      period.end,
      () => `todo_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    );
    if (changed) cycles[String(period.start)] = cycleDataByCategory;
  }

  nextItem =
    cycles[cycleKey]?.[categoryKey]?.items?.find((i) => i.id === current.id) ||
    nextItem;

  await mergeDoc(db, `clients/${client.id}`, { todoCycles: cycles });

  const title = String(current.text || 'Task').trim() || 'Task';

  try {
    await createMessageDoc({
      clientId: client.id,
      body: `Auto-approved task (review deadline passed): ${title}`,
      authorType: 'staff',
      authorEmail: SYSTEM_EMAIL,
      authorName: 'Ignite Time Tracker',
      attachments: [],
      createdAt: now,
      systemKind: 'todo_approval_decision',
    });
  } catch (err) {
    console.warn('[auto-approve-client-reviews] message:', err?.message || err);
  }

  const notifyEmails = collectClientStaffNotifyEmails(client, [
    current.approvalRequestedByEmail,
    ...(Array.isArray(current.assigneeEmails) ? current.assigneeEmails : []),
  ]);

  try {
    await notifyStaffTodoApprovalDecision({
      client,
      title,
      status: 'approved',
      note: 'Auto-approved after review deadline with no client response.',
      byEmail: SYSTEM_EMAIL,
      notifyEmails,
    });
  } catch (err) {
    console.warn('[auto-approve-client-reviews] email:', err?.message || err);
  }

  try {
    await writeStaffInboxNotifications({
      recipientEmails: notifyEmails,
      type: 'todo_approval',
      title: `Auto-approved: ${title}`,
      body: `${client.name || 'Client'} · review deadline passed`,
      actorEmail: SYSTEM_EMAIL,
      actorName: 'Auto-approve',
      clientId: client.id,
      clientName: client.name || '',
      categoryKey,
      itemId: current.id,
      idPrefix: 'todo_appr_auto',
    });
  } catch (err) {
    console.warn('[auto-approve-client-reviews] inbox:', err?.message || err);
  }

  try {
    await writeClientActivity({
      clientId: client.id,
      type: 'todo_approval_decision',
      summary: `Auto-approved “${title}” after review deadline`,
      meta: {
        categoryKey,
        itemId: current.id,
        decision: 'approved',
        autoApproved: true,
      },
    });
  } catch (err) {
    console.warn('[auto-approve-client-reviews] activity:', err?.message || err);
  }

  return { ok: true, title, nextItem };
}

export default async () => {
  const db = await getDigestDb();
  const clients = await fetchCollection(db, 'clients');
  const now = Date.now();
  let approved = 0;
  const details = [];

  for (const client of clients || []) {
    if (!client?.id || client.archived) continue;
    const cycles = client.todoCycles || {};
    for (const [cycleKey, cycleData] of Object.entries(cycles)) {
      if (!cycleData || typeof cycleData !== 'object') continue;
      for (const [categoryKey, catTodo] of Object.entries(cycleData)) {
        const items = Array.isArray(catTodo?.items) ? catTodo.items : [];
        for (const item of items) {
          if (!isTodoReadyForAutoApprove(item, now)) continue;
          try {
            const result = await autoApproveOne({
              db,
              client,
              cycleStart: Number(cycleKey) || cycleKey,
              categoryKey,
              item,
              now,
            });
            if (result.ok) {
              approved += 1;
              details.push({
                clientId: client.id,
                clientName: client.name || '',
                itemId: item.id,
                title: result.title,
              });
              // Refresh in-memory client cycles for subsequent items on same client
              client.todoCycles = {
                ...(client.todoCycles || {}),
                [cycleKey]: {
                  ...(client.todoCycles?.[cycleKey] || {}),
                  [categoryKey]: {
                    ...(client.todoCycles?.[cycleKey]?.[categoryKey] || {}),
                    items: (
                      client.todoCycles?.[cycleKey]?.[categoryKey]?.items || items
                    ).map((i) =>
                      i?.id === item.id ? result.nextItem : i,
                    ),
                  },
                },
              };
            }
          } catch (err) {
            console.error(
              '[auto-approve-client-reviews] item failed',
              client.id,
              item?.id,
              err?.message || err,
            );
            details.push({
              clientId: client.id,
              itemId: item?.id,
              error: err?.message || String(err),
            });
          }
        }
      }
    }
  }

  console.log(
    `[auto-approve-client-reviews] approved=${approved} checked_clients=${(clients || []).length}`,
  );
  return new Response(
    JSON.stringify({ ok: true, approved, details: details.slice(0, 50) }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
};

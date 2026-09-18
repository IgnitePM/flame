import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import { getBillingPeriod } from '../../src/utils/billingEngine.js';
import {
  applyTodoApprovalSend,
  isTodoPendingApproval,
} from '../../src/utils/todoApproval.js';
import {
  createMessageDoc,
  loadClient,
  mergeDoc,
  getDigestDb,
  notifyPortalTodoApprovalSent,
  notifyStaffTodoReviewRequested,
  writeClientActivity,
  writeStaffInboxNotifications,
} from './lib/clientMessaging.mjs';

/**
 * Staff: send a retainer task for client or staff approval.
 * POST {
 *   clientId, cycleStart, categoryKey, itemId,
 *   target: 'client'|'staff',
 *   reviewerEmails?: string[],
 *   note?: string
 * }
 */
export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let caller;
  try {
    caller = await requireStaffCaller(req.headers);
  } catch (err) {
    const { status, message } = describeAuthError(err);
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const clientId = String(body.clientId || '').trim();
  const categoryKey = String(body.categoryKey || '').trim();
  const itemId = String(body.itemId || '').trim();
  const target = String(body.target || '').trim() === 'staff' ? 'staff' : 'client';
  const note = String(body.note || '').trim();
  const reviewerEmails = Array.isArray(body.reviewerEmails)
    ? body.reviewerEmails
    : [];
  const reviewDeadlineRaw = Number(body.reviewDeadline) || 0;
  const approvalAutoApprove = Boolean(body.approvalAutoApprove);

  if (!clientId || !categoryKey || !itemId) {
    return new Response(
      JSON.stringify({ error: 'clientId, categoryKey, and itemId are required.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  try {
    const client = await loadClient(clientId);
    const cycleStart = Number(body.cycleStart) || getBillingPeriod(client.billingDay || 1, 0).start;
    const cycleKey = String(cycleStart);
    const cycles = { ...(client.todoCycles || {}) };
    const cycleData = { ...(cycles[cycleKey] || {}) };
    const catTodo = cycleData[categoryKey] || { closed: false, items: [] };
    const items = Array.isArray(catTodo.items) ? [...catTodo.items] : [];
    const idx = items.findIndex((i) => i?.id === itemId);
    if (idx < 0) {
      return new Response(JSON.stringify({ error: 'Task not found.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const item = items[idx];
    if (item.done) {
      return new Response(
        JSON.stringify({ error: 'This task is already complete.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (isTodoPendingApproval(item)) {
      return new Response(
        JSON.stringify({ error: 'This task is already awaiting approval.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    let nextItem;
    try {
      nextItem = applyTodoApprovalSend(item, {
        target,
        reviewerEmails,
        note,
        byEmail: caller.email,
        reviewDeadline: reviewDeadlineRaw > 0 ? reviewDeadlineRaw : null,
        approvalAutoApprove: target === 'client' ? approvalAutoApprove : false,
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err?.message || 'Invalid approval request.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    items[idx] = nextItem;
    cycleData[categoryKey] = { ...catTodo, items };
    cycles[cycleKey] = cycleData;

    const db = await getDigestDb();
    await mergeDoc(db, `clients/${clientId}`, { todoCycles: cycles });

    const title = String(nextItem.text || 'Task').trim() || 'Task';
    let emailResult = { sent: 0 };
    try {
      if (target === 'client') {
        emailResult = await notifyPortalTodoApprovalSent({
          client,
          title,
          note,
        });
        await createMessageDoc({
          clientId,
          body: `Task ready for your approval: ${title}${note ? `\n\n${note}` : ''}`,
          authorType: 'staff',
          authorEmail: caller.email,
          authorName: caller.email,
          attachments: [],
          createdAt: Date.now(),
          systemKind: 'todo_approval_sent',
        });
      } else {
        emailResult = await notifyStaffTodoReviewRequested({
          client,
          title,
          note,
          byEmail: caller.email,
          reviewerEmails: nextItem.approvalReviewerEmails,
        });
        try {
          await writeStaffInboxNotifications({
            recipientEmails: nextItem.approvalReviewerEmails || [],
            type: 'todo_approval',
            title: `Review requested: ${title}`,
            body: note
              ? `${caller.email || 'Teammate'} · ${client.name || 'Client'}: ${note}`
              : `${caller.email || 'Teammate'} asked you to review on ${
                  client.name || 'a client'
                }`,
            actorEmail: caller.email,
            actorName: caller.email,
            clientId,
            clientName: client.name || '',
            categoryKey,
            itemId,
            idPrefix: 'todo_staff_review',
          });
        } catch (inboxErr) {
          console.warn(
            '[client-todo-approval-send] inbox:',
            inboxErr?.message || inboxErr,
          );
        }
      }
    } catch (err) {
      console.warn('[client-todo-approval-send] notify:', err?.message || err);
      emailResult = { sent: 0, error: err?.message || String(err) };
    }

    try {
      await writeClientActivity({
        clientId,
        clientName: client.name || '',
        type: 'todo_approval_sent',
        title:
          target === 'client'
            ? `Sent for client approval: ${title}`
            : `Sent for staff review: ${title}`,
        body: note.slice(0, 500),
        actorEmail: caller.email,
        source: 'system',
        meta: {
          itemId,
          categoryKey,
          cycleStart,
          target,
          reviewerEmails: nextItem.approvalReviewerEmails || [],
        },
      });
    } catch (err) {
      console.warn('[client-todo-approval-send] activity:', err?.message || err);
    }

    return new Response(
      JSON.stringify({ ok: true, item: nextItem, email: emailResult }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[client-todo-approval-send]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not send for approval.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

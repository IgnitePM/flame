import {
  describeAuthError,
  requireClientOrStaffCaller,
} from './lib/requireAuth.mjs';
import { getBillingPeriod } from '../../src/utils/billingEngine.js';
import {
  applyTodoApprovalDecision,
  isTodoAwaitingClientApproval,
  isTodoAwaitingStaffApproval,
} from '../../src/utils/todoApproval.js';
import {
  markPrimaryTodoDoneAcrossCycles,
  reconcileRecurringTodoInstances,
  recurringAnchorKey,
} from '../../src/utils/recurringTodoMaterialize.js';
import {
  createMessageDoc,
  getDigestDb,
  loadClient,
  mergeDoc,
  notifyStaffTodoApprovalDecision,
  writeClientActivity,
  writeStaffInboxNotifications,
  collectClientStaffNotifyEmails,
} from './lib/clientMessaging.mjs';

/**
 * Client or staff: decide a pending task approval.
 * POST {
 *   clientId, cycleStart?, categoryKey, itemId,
 *   decision: 'approved'|'revisions_requested',
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

  let body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const clientId = String(body.clientId || '').trim();
  const categoryKey = String(body.categoryKey || '').trim();
  const itemId = String(body.itemId || '').trim();
  const decision = String(body.decision || '').trim();
  const note = String(body.decisionNote || body.note || '').trim();

  if (!clientId || !categoryKey || !itemId) {
    return new Response(
      JSON.stringify({ error: 'clientId, categoryKey, and itemId are required.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  if (!['approved', 'revisions_requested'].includes(decision)) {
    return new Response(
      JSON.stringify({ error: 'decision must be approved or revisions_requested.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let caller;
  try {
    caller = await requireClientOrStaffCaller(req.headers, clientId);
  } catch (err) {
    const { status, message } = describeAuthError(err);
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const client = await loadClient(clientId);
    const period = getBillingPeriod(client.billingDay || 1, 0);
    const cycleStart = Number(body.cycleStart) || period.start;
    const cycleKey = String(cycleStart);
    let cycles = { ...(client.todoCycles || {}) };
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
    const awaitingClient = isTodoAwaitingClientApproval(item);
    const awaitingStaff = isTodoAwaitingStaffApproval(item);
    if (!awaitingClient && !awaitingStaff) {
      return new Response(
        JSON.stringify({ error: 'This task is not awaiting approval.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (awaitingClient && !caller.isStaff && caller.authorType !== 'client') {
      return new Response(JSON.stringify({ error: 'Not allowed.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (awaitingStaff && !caller.isStaff) {
      return new Response(
        JSON.stringify({ error: 'Only staff can decide staff reviews.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (awaitingStaff && caller.isStaff) {
      const reviewers = (item.approvalReviewerEmails || []).map((e) =>
        String(e || '').trim().toLowerCase(),
      );
      const me = String(caller.email || '').trim().toLowerCase();
      const isReviewer = reviewers.includes(me);
      const isAdmin =
        caller.role === 'admin' ||
        caller.role === 'billing' ||
        me === String(item.approvalRequestedByEmail || '').toLowerCase();
      if (!isReviewer && !isAdmin) {
        return new Response(
          JSON.stringify({ error: 'You are not a reviewer on this task.' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }

    const now = Date.now();
    let nextItem = applyTodoApprovalDecision(item, {
      decision,
      note,
      byEmail: caller.email,
      now,
    });

    items[idx] = nextItem;
    cycleData[categoryKey] = { ...catTodo, items };
    cycles[cycleKey] = cycleData;

    if (decision === 'approved') {
      let recurringSkipKey = '';
      if (item.recurring) {
        recurringSkipKey = recurringAnchorKey(
          item.recurringId || item.id,
          item.dueDate,
        );
      }
      const { cycles: markedCycles, touched } = markPrimaryTodoDoneAcrossCycles(
        cycles,
        categoryKey,
        itemId,
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

      // Re-read item after across-cycle mark for response
      nextItem =
        cycles[cycleKey]?.[categoryKey]?.items?.find((i) => i.id === itemId) ||
        nextItem;
    }

    const db = await getDigestDb();
    await mergeDoc(db, `clients/${clientId}`, { todoCycles: cycles });

    const title = String(item.text || 'Task').trim() || 'Task';
    const label = decision === 'approved' ? 'Approved' : 'Revisions requested';

    try {
      await createMessageDoc({
        clientId,
        body: `${label} task: ${title}${note ? `\n\n${note}` : ''}`,
        authorType: caller.authorType || (caller.isStaff ? 'staff' : 'client'),
        authorEmail: caller.email,
        authorName: caller.email,
        attachments: [],
        createdAt: now,
        systemKind: 'todo_approval_decision',
      });
    } catch (err) {
      console.warn('[client-todo-approval-decide] message:', err?.message || err);
    }

    let emailResult = { sent: 0 };
    const notifyEmails = collectClientStaffNotifyEmails(client, [
      item.approvalRequestedByEmail,
      ...(Array.isArray(item.assigneeEmails) ? item.assigneeEmails : []),
      ...(Array.isArray(item.approvalReviewerEmails)
        ? item.approvalReviewerEmails
        : []),
    ]);
    try {
      emailResult = await notifyStaffTodoApprovalDecision({
        client,
        title,
        status: decision,
        note,
        byEmail: caller.email,
        notifyEmails,
      });
    } catch (err) {
      console.warn('[client-todo-approval-decide] email:', err?.message || err);
      emailResult = { sent: 0, error: err?.message || String(err) };
    }

    try {
      const who =
        caller.authorType === 'client' || !caller.isStaff
          ? 'Client'
          : caller.email || 'Staff';
      await writeStaffInboxNotifications({
        recipientEmails: notifyEmails,
        type: 'todo_approval',
        title: `${label}: ${title}`,
        body: note
          ? `${who} · ${client.name || 'Client'}: ${note}`
          : `${who} · ${client.name || 'Client'}`,
        actorEmail: caller.email,
        actorName: who,
        clientId,
        clientName: client.name || '',
        categoryKey,
        itemId,
        idPrefix: `todo_appr_${decision === 'approved' ? 'ok' : 'rev'}`,
      });
    } catch (err) {
      console.warn('[client-todo-approval-decide] inbox:', err?.message || err);
    }

    try {
      await writeClientActivity({
        clientId,
        clientName: client.name || '',
        type: 'todo_approval_decision',
        title: `${label}: ${title}`,
        body: note.slice(0, 500),
        actorEmail: caller.email,
        source: 'system',
        meta: {
          itemId,
          categoryKey,
          cycleStart,
          decision,
          approvalStatus: nextItem.approvalStatus || null,
        },
      });
    } catch (err) {
      console.warn('[client-todo-approval-decide] activity:', err?.message || err);
    }

    return new Response(
      JSON.stringify({ ok: true, item: nextItem, email: emailResult }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[client-todo-approval-decide]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not save decision.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

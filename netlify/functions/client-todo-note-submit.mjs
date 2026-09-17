import {
  describeAuthError,
  requireClientOrStaffCaller,
} from './lib/requireAuth.mjs';
import { getBillingPeriod } from '../../src/utils/billingEngine.js';
import {
  appendTaskComment,
  buildTaskComment,
} from '../../src/utils/taskComments.js';
import {
  collectClientStaffNotifyEmails,
  createMessageDoc,
  getDigestDb,
  loadClient,
  mergeDoc,
  notifyStaffPortalTodoNote,
  writeClientActivity,
  writeStaffInboxNotifications,
} from './lib/clientMessaging.mjs';

/**
 * Client (or staff preview): append a note on a retainer task.
 * POST { clientId, cycleStart?, categoryKey, itemId, text, authorName? }
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
  const text = String(body.text || '').trim();

  if (!clientId || !categoryKey || !itemId) {
    return new Response(
      JSON.stringify({ error: 'clientId, categoryKey, and itemId are required.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  if (text.length < 2) {
    return new Response(JSON.stringify({ error: 'Please write a short note.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (text.length > 4000) {
    return new Response(
      JSON.stringify({ error: 'Note is too long (max 4000 characters).' }),
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
    const authorName =
      String(body.authorName || '').trim().slice(0, 80) ||
      caller.email ||
      'Client';
    const comment = buildTaskComment({
      text,
      authorEmail: caller.email,
      authorName,
    });
    if (!comment) {
      return new Response(JSON.stringify({ error: 'Could not build note.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const nextItem = appendTaskComment(item, comment);
    items[idx] = nextItem;
    cycleData[categoryKey] = { ...catTodo, items };
    cycles[cycleKey] = cycleData;

    const db = await getDigestDb();
    await mergeDoc(db, `clients/${clientId}`, { todoCycles: cycles });

    const title = String(item.text || 'Task').trim() || 'Task';
    const now = Date.now();

    try {
      await createMessageDoc({
        clientId,
        body: `Note on task: ${title}\n\n${comment.text}`,
        authorType: caller.authorType || (caller.isStaff ? 'staff' : 'client'),
        authorEmail: caller.email,
        authorName,
        attachments: [],
        createdAt: now,
        systemKind: 'portal_todo_note',
      });
    } catch (err) {
      console.warn('[client-todo-note-submit] message:', err?.message || err);
    }

    const notifyEmails = collectClientStaffNotifyEmails(client, [
      ...(Array.isArray(item.assigneeEmails) ? item.assigneeEmails : []),
    ]);

    let emailResult = { sent: 0 };
    try {
      emailResult = await notifyStaffPortalTodoNote({
        client,
        title,
        note: comment.text,
        byEmail: caller.email,
        notifyEmails,
      });
    } catch (err) {
      console.warn('[client-todo-note-submit] email:', err?.message || err);
      emailResult = { sent: 0, error: err?.message || String(err) };
    }

    try {
      await writeStaffInboxNotifications({
        recipientEmails: notifyEmails,
        type: 'portal_todo_note',
        title: `Note on: ${title}`,
        body: `${caller.email} · ${client.name || 'Client'}: ${comment.text.slice(0, 280)}`,
        actorEmail: caller.email,
        actorName,
        clientId,
        clientName: client.name || '',
        categoryKey,
        itemId,
        idPrefix: 'portal_note',
      });
    } catch (err) {
      console.warn('[client-todo-note-submit] inbox:', err?.message || err);
    }

    try {
      await writeClientActivity({
        clientId,
        clientName: client.name || '',
        type: 'portal_todo_note',
        title: `Note on: ${title}`,
        body: comment.text.slice(0, 500),
        actorEmail: caller.email,
        source: 'system',
        meta: {
          itemId,
          categoryKey,
          cycleStart,
          commentId: comment.id,
        },
      });
    } catch (err) {
      console.warn('[client-todo-note-submit] activity:', err?.message || err);
    }

    return new Response(
      JSON.stringify({ ok: true, comment, item: nextItem, email: emailResult }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[client-todo-note-submit]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not save note.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

import {
  describeAuthError,
  requireClientOrStaffCaller,
} from './lib/requireAuth.mjs';
import {
  getDigestDb,
  mergeDoc,
  fetchDoc,
} from './lib/firebaseDigestClient.mjs';
import { writeClientActivity } from './lib/clientActivity.mjs';
import { sendDigestEmail } from './lib/mailer.mjs';
import { appBaseUrl } from './lib/clientMessaging.mjs';
import { getBillingPeriod } from '../../src/utils/billingEngine.js';

function todoCategoryKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Portal: request a retainer/category task (pending staff approval).
 * POST { clientId, categoryKey?, categoryLabel?, text, estimatedHours? }
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
  const text = String(body.text || '').trim();
  if (!text) {
    return new Response(JSON.stringify({ error: 'Task text is required.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
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
    const db = await getDigestDb();
    const client = await fetchDoc(db, `clients/${clientId}`);
    if (!client) {
      return new Response(JSON.stringify({ error: 'Client not found.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const cycleStart = getBillingPeriod(client.billingDay || 1, 0).start;

    const label = String(body.categoryLabel || body.category || '').trim();
    const categoryKey =
      String(body.categoryKey || '').trim() ||
      (label ? todoCategoryKey(label) : todoCategoryKey('General / Unclassified'));

    const estimatedHours = Math.max(0, Number(body.estimatedHours) || 0) || null;
    const itemId = `todo_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const newItem = {
      id: itemId,
      text,
      done: false,
      doneAt: null,
      pinned: false,
      recurring: false,
      recurringId: null,
      dueDate: null,
      assigneeEmails: [],
      recurrence: null,
      estimatedHours,
      requestStatus: 'pending',
      requestedByEmail: caller.email,
      requestedAt: Date.now(),
      decisionByEmail: null,
      decisionAt: null,
      decisionNote: '',
    };

    const cycles = { ...(client.todoCycles || {}) };
    const cycleKey = String(cycleStart);
    const cycleData = { ...(cycles[cycleKey] || {}) };
    const catTodo = cycleData[categoryKey] || { closed: false, items: [] };
    const items = Array.isArray(catTodo.items) ? [...catTodo.items] : [];
    items.push(newItem);
    cycleData[categoryKey] = { ...catTodo, closed: false, items };
    cycles[cycleKey] = cycleData;

    await mergeDoc(db, `clients/${clientId}`, { todoCycles: cycles });

    const team = Array.isArray(client.teamMemberAccessEmails)
      ? client.teamMemberAccessEmails
          .map((e) => String(e || '').trim().toLowerCase())
          .filter((e) => e.includes('@'))
      : [];
    if (team.length) {
      try {
        const href = `${appBaseUrl()}/clients/${clientId}?tab=tasks`;
        await sendDigestEmail({
          to: [...new Set(team)],
          subject: `New task request — ${client.name || 'Client'}`,
          text: `${caller.email} requested a task:\n\n${text}\n\nOpen: ${href}`,
          html: `<p><strong>${caller.email}</strong> requested a task on <strong>${client.name || 'Client'}</strong>:</p><p>${text.replace(/</g, '&lt;')}</p><p><a href="${href}">Review in CRM</a></p>`,
        });
      } catch (err) {
        console.warn('[client-todo-request] email:', err?.message || err);
      }
    }

    try {
      await writeClientActivity({
        clientId,
        clientName: client.name || '',
        type: 'todo_request',
        title: 'Client requested a task',
        body: text.slice(0, 500),
        actorEmail: caller.email,
        source: 'system',
        meta: { itemId, categoryKey, estimatedHours },
      });
    } catch (err) {
      console.warn('[client-todo-request] activity:', err?.message || err);
    }

    return new Response(
      JSON.stringify({ ok: true, item: newItem, categoryKey, cycleStart }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[client-todo-request]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not submit request.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

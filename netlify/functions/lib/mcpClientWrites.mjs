/**
 * Staff write helpers for the Perplexity MCP connector.
 * Creates notes + todos only — no deletes, no portal requests, no secrets.
 */

import { getBillingPeriod } from '../../../src/utils/billingEngine.js';
import { buildTeamAccessMergeForTodoAssignees } from '../../../src/utils/teamClientAccess.js';
import { writeClientActivity } from './clientActivity.mjs';
import { fetchDoc, getDigestDb, mergeDoc } from './firebaseDigestClient.mjs';
import { clip } from './mcpSanitize.mjs';
import {
  buildStaffTodoItem,
  mergeNoteText,
  resolveMcpActorEmail,
  resolveRetainerCategory,
} from './mcpClientWriteUtils.mjs';

export {
  buildStaffTodoItem,
  mergeNoteText,
  normalizeAssigneeEmails,
  parseDueDateMs,
  resolveMcpActorEmail,
  resolveRetainerCategory,
  todoCategoryKey,
} from './mcpClientWriteUtils.mjs';

export async function createClientNote(client, args = {}) {
  const scope = String(args.scope || 'general').trim().toLowerCase();
  const mode =
    String(args.mode || 'append').trim().toLowerCase() === 'replace'
      ? 'replace'
      : 'append';
  const actorEmail = resolveMcpActorEmail(args.actorEmail);
  const db = await getDigestDb();
  const existing = (await fetchDoc(db, `clientNotes/${client.id}`)) || {};

  if (scope === 'cycle') {
    const { categoryLabel, categoryKey } = resolveRetainerCategory(client, args);
    const cycleStart =
      Number(args.cycleStart) || getBillingPeriod(client.billingDay || 1, 0).start;
    const cycleKey = String(cycleStart);
    const prevMap =
      existing.cycleNotes?.[cycleKey] &&
      typeof existing.cycleNotes[cycleKey] === 'object'
        ? existing.cycleNotes[cycleKey]
        : {};
    const prevText = String(prevMap[categoryKey] || '');
    const nextText = mergeNoteText(prevText, args.text, mode);
    await mergeDoc(db, `clientNotes/${client.id}`, {
      cycleNotes: {
        [cycleKey]: {
          [categoryKey]: nextText,
        },
      },
    });
    try {
      await writeClientActivity({
        clientId: client.id,
        clientName: client.name || '',
        type: 'client_note_saved',
        title: 'Cycle note updated (Perplexity)',
        body: clip(nextText, 500),
        actorEmail,
        source: 'system',
        meta: {
          source: 'perplexity_mcp',
          scope: 'cycle',
          mode,
          categoryKey,
          cycleStart,
        },
      });
    } catch (err) {
      console.warn('[mcp-write] activity note:', err?.message || err);
    }
    return {
      ok: true,
      clientId: client.id,
      clientName: client.name,
      scope: 'cycle',
      mode,
      category: categoryLabel,
      categoryKey,
      cycleStart,
      notePreview: clip(nextText, 400),
    };
  }

  if (scope !== 'general') {
    const err = new Error('scope must be "general" or "cycle".');
    err.code = 'bad_request';
    throw err;
  }

  const nextText = mergeNoteText(existing.generalNotes, args.text, mode);
  await mergeDoc(db, `clientNotes/${client.id}`, { generalNotes: nextText });
  try {
    await writeClientActivity({
      clientId: client.id,
      clientName: client.name || '',
      type: 'client_note_saved',
      title: 'Internal note updated (Perplexity)',
      body: clip(nextText, 500),
      actorEmail,
      source: 'system',
      meta: { source: 'perplexity_mcp', scope: 'general', mode },
    });
  } catch (err) {
    console.warn('[mcp-write] activity note:', err?.message || err);
  }
  return {
    ok: true,
    clientId: client.id,
    clientName: client.name,
    scope: 'general',
    mode,
    notePreview: clip(nextText, 400),
  };
}

export async function createTodo(client, args = {}) {
  const { categoryLabel, categoryKey } = resolveRetainerCategory(client, args);
  const actorEmail = resolveMcpActorEmail(args.actorEmail);
  const cycleStart =
    Number(args.cycleStart) || getBillingPeriod(client.billingDay || 1, 0).start;
  const item = buildStaffTodoItem({
    text: args.text,
    assigneeEmails: args.assigneeEmails,
    dueDate: args.dueDate,
    estimatedHours: args.estimatedHours,
    pinned: args.pinned,
  });

  const db = await getDigestDb();
  const fresh = (await fetchDoc(db, `clients/${client.id}`)) || client;
  const cycles = { ...(fresh.todoCycles || {}) };
  const cycleKey = String(cycleStart);
  const cycleData = { ...(cycles[cycleKey] || {}) };
  const catTodo = cycleData[categoryKey] || { closed: false, items: [] };
  if (catTodo.closed) {
    const err = new Error(
      'That category is closed for this billing cycle. Unlock it in the CRM first.',
    );
    err.code = 'cycle_closed';
    throw err;
  }
  const items = Array.isArray(catTodo.items) ? [...catTodo.items] : [];
  items.push(item);
  cycleData[categoryKey] = { ...catTodo, closed: false, items };
  cycles[cycleKey] = cycleData;

  const teamAccessPatch = buildTeamAccessMergeForTodoAssignees(fresh, cycles);
  await mergeDoc(db, `clients/${client.id}`, {
    todoCycles: cycles,
    ...teamAccessPatch,
  });

  try {
    await writeClientActivity({
      clientId: client.id,
      clientName: client.name || '',
      type: 'todo_created',
      title: 'Task created (Perplexity)',
      body: clip(item.text, 500),
      actorEmail,
      source: 'system',
      meta: {
        source: 'perplexity_mcp',
        itemId: item.id,
        categoryKey,
        cycleStart,
        assigneeEmails: item.assigneeEmails,
      },
    });
  } catch (err) {
    console.warn('[mcp-write] activity todo:', err?.message || err);
  }

  return {
    ok: true,
    clientId: client.id,
    clientName: client.name,
    category: categoryLabel,
    categoryKey,
    cycleStart,
    item: {
      id: item.id,
      text: item.text,
      dueDate: item.dueDate,
      assigneeEmails: item.assigneeEmails,
      estimatedHours: item.estimatedHours,
      pinned: item.pinned,
    },
  };
}

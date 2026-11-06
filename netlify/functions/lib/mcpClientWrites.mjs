/**
 * Staff write helpers for the Perplexity MCP connector.
 * Creates notes, todos/subtasks/comments, completion, time, expenses/credits,
 * and document links. No deletes, no portal requests, no raw file uploads.
 */

import { getBillingPeriod } from '../../../src/utils/billingEngine.js';
import { isClientActiveForWork } from '../../../src/utils/clientActiveForWork.js';
import {
  MAX_TODO_ATTACHMENTS,
  addAttachmentToItem,
  buildDriveDocumentRecord,
  buildClientDocumentRecord,
  getTodoAttachments,
  newDocumentId,
} from '../../../src/utils/clientDocuments.js';
import { FALLBACK_FX_TO_CAD, getFxToCad } from '../../../src/utils/fxToCad.js';
import { buildPerplexityExpenseDescription } from '../../../src/utils/perplexityCredits.js';
import {
  markPrimaryTodoDoneAcrossCycles,
  recurringAnchorKey,
} from '../../../src/utils/recurringTodoMaterialize.js';
import {
  appendTaskComment,
  buildTaskComment,
  syncTaskCommentsAcrossCycles,
} from '../../../src/utils/taskComments.js';
import { buildTeamAccessMergeForTodoAssignees } from '../../../src/utils/teamClientAccess.js';
import {
  addSubtaskToItems,
  canMarkParentTodoDone,
  clampAllSubtaskDueDatesToParent,
  setSubtaskDoneInItems,
} from '../../../src/utils/todoSubtasks.js';
import { writeClientActivity } from './clientActivity.mjs';
import {
  createDoc,
  fetchDoc,
  getDigestDb,
  mergeDoc,
} from './firebaseDigestClient.mjs';
import { clip } from './mcpSanitize.mjs';
import {
  MAX_TODO_TEXT,
  buildStaffSubtask,
  buildStaffTodoItem,
  computeExpenseAmounts,
  extractDriveFileId,
  findTodoInClient,
  mergeNoteText,
  parseDueDateMs,
  resolveDurationMs,
  resolveMcpActorEmail,
  resolveRetainerCategory,
} from './mcpClientWriteUtils.mjs';

export {
  buildStaffSubtask,
  buildStaffTodoItem,
  computeExpenseAmounts,
  extractDriveFileId,
  findTodoInClient,
  mergeNoteText,
  normalizeAssigneeEmails,
  parseDueDateMs,
  resolveDurationMs,
  resolveMcpActorEmail,
  resolveRetainerCategory,
  todoCategoryKey,
} from './mcpClientWriteUtils.mjs';

function assertActiveClient(client) {
  if (!isClientActiveForWork(client)) {
    const err = new Error(
      'Client is inactive, paused, or archived. Writes are blocked.',
    );
    err.code = 'inactive_client';
    throw err;
  }
}

async function loadFxToCad(db) {
  try {
    const live = await fetchDoc(db, 'settings/fxRates');
    return getFxToCad(live?.rates || live || FALLBACK_FX_TO_CAD);
  } catch {
    return getFxToCad(FALLBACK_FX_TO_CAD);
  }
}

async function writeTodoCycles(client, cycles) {
  const db = await getDigestDb();
  const teamAccessPatch = buildTeamAccessMergeForTodoAssignees(client, cycles);
  await mergeDoc(db, `clients/${client.id}`, {
    todoCycles: cycles,
    ...teamAccessPatch,
  });
}

export async function createClientNote(client, args = {}) {
  assertActiveClient(client);
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
  assertActiveClient(client);
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

  const subtaskArgs = Array.isArray(args.subtasks) ? args.subtasks : [];
  for (const s of subtaskArgs.slice(0, 20)) {
    item.subtasks.push(buildStaffSubtask(item, s));
  }

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

  await writeTodoCycles(fresh, cycles);

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
        subtaskCount: item.subtasks.length,
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
      subtasks: item.subtasks.map((s) => ({
        id: s.id,
        text: s.text,
        dueDate: s.dueDate,
        assigneeEmails: s.assigneeEmails,
      })),
    },
  };
}

export async function addSubtask(client, args = {}) {
  assertActiveClient(client);
  const actorEmail = resolveMcpActorEmail(args.actorEmail);
  const db = await getDigestDb();
  const fresh = (await fetchDoc(db, `clients/${client.id}`)) || client;
  const found = findTodoInClient(fresh, args.todoId, {
    cycleStart: args.cycleStart,
    categoryKey: args.categoryKey,
  });
  if (!found) {
    const err = new Error('Todo not found. Pass todoId from list_open_todos / create_todo.');
    err.code = 'not_found';
    throw err;
  }
  if (found.item.done) {
    const err = new Error('Cannot add subtasks to a completed task.');
    err.code = 'todo_done';
    throw err;
  }

  const sub = buildStaffSubtask(found.item, args);
  const cycles = { ...(fresh.todoCycles || {}) };
  const cycleData = { ...(cycles[found.cycleKey] || {}) };
  const catTodo = cycleData[found.categoryKey] || { closed: false, items: [] };
  const items = addSubtaskToItems(
    Array.isArray(catTodo.items) ? [...catTodo.items] : [],
    found.item.id,
    sub,
  );
  cycleData[found.categoryKey] = { ...catTodo, items };
  cycles[found.cycleKey] = cycleData;
  await writeTodoCycles(fresh, cycles);

  try {
    await writeClientActivity({
      clientId: client.id,
      clientName: client.name || '',
      type: 'todo_created',
      title: 'Subtask added (Perplexity)',
      body: clip(sub.text, 500),
      actorEmail,
      source: 'system',
      meta: {
        source: 'perplexity_mcp',
        todoId: found.item.id,
        subtaskId: sub.id,
        categoryKey: found.categoryKey,
        cycleStart: found.cycleStart,
      },
    });
  } catch (err) {
    console.warn('[mcp-write] activity subtask:', err?.message || err);
  }

  return {
    ok: true,
    clientId: client.id,
    clientName: client.name,
    todoId: found.item.id,
    categoryKey: found.categoryKey,
    cycleStart: found.cycleStart,
    subtask: {
      id: sub.id,
      text: sub.text,
      dueDate: sub.dueDate,
      assigneeEmails: sub.assigneeEmails,
      estimatedHours: sub.estimatedHours,
    },
  };
}

export async function addTodoComment(client, args = {}) {
  assertActiveClient(client);
  const actorEmail = resolveMcpActorEmail(args.actorEmail);
  const text = String(args.text || '').trim();
  if (!text) {
    const err = new Error('Comment text is required.');
    err.code = 'bad_request';
    throw err;
  }
  if (text.length > MAX_TODO_TEXT) {
    const err = new Error(`Comment text exceeds ${MAX_TODO_TEXT} characters.`);
    err.code = 'too_long';
    throw err;
  }

  const db = await getDigestDb();
  const fresh = (await fetchDoc(db, `clients/${client.id}`)) || client;
  const found = findTodoInClient(fresh, args.todoId, {
    cycleStart: args.cycleStart,
    categoryKey: args.categoryKey,
  });
  if (!found) {
    const err = new Error('Todo not found. Pass todoId from list_open_todos.');
    err.code = 'not_found';
    throw err;
  }

  const portalEmails = Array.isArray(fresh.clientEmails) ? fresh.clientEmails : [];
  const comment = buildTaskComment({
    text,
    authorEmail: actorEmail,
    authorName: String(args.authorName || '').trim() || actorEmail.split('@')[0] || 'Perplexity',
    clientEmails: portalEmails,
    clientName: fresh.name || '',
  });
  if (!comment) {
    const err = new Error('Comment text is required.');
    err.code = 'bad_request';
    throw err;
  }

  const cycles = { ...(fresh.todoCycles || {}) };
  const cycleData = { ...(cycles[found.cycleKey] || {}) };
  const catTodo = cycleData[found.categoryKey] || { closed: false, items: [] };
  const items = (Array.isArray(catTodo.items) ? catTodo.items : []).map((row) =>
    row.id === found.item.id ? appendTaskComment(row, comment) : row,
  );
  cycleData[found.categoryKey] = { ...catTodo, items };
  cycles[found.cycleKey] = cycleData;

  const synced = syncTaskCommentsAcrossCycles(
    cycles,
    found.categoryKey,
    items,
  );
  await writeTodoCycles(fresh, synced.cycles);

  try {
    await writeClientActivity({
      clientId: client.id,
      clientName: client.name || '',
      type: 'todo_created',
      title: 'Task comment added (Perplexity)',
      body: clip(comment.text, 500),
      actorEmail,
      source: 'system',
      meta: {
        source: 'perplexity_mcp',
        todoId: found.item.id,
        commentId: comment.id,
        categoryKey: found.categoryKey,
        cycleStart: found.cycleStart,
      },
    });
  } catch (err) {
    console.warn('[mcp-write] activity comment:', err?.message || err);
  }

  return {
    ok: true,
    clientId: client.id,
    clientName: client.name,
    todoId: found.item.id,
    categoryKey: found.categoryKey,
    cycleStart: found.cycleStart,
    comment: {
      id: comment.id,
      text: comment.text,
      authorEmail: comment.authorEmail,
      authorName: comment.authorName,
      createdAt: comment.createdAt,
    },
  };
}

export async function completeTodo(client, args = {}) {
  assertActiveClient(client);
  const actorEmail = resolveMcpActorEmail(args.actorEmail);
  const uncomplete =
    args.done === false ||
    args.uncomplete === true ||
    String(args.action || '').toLowerCase() === 'uncomplete';
  const done = !uncomplete;

  const db = await getDigestDb();
  const fresh = (await fetchDoc(db, `clients/${client.id}`)) || client;
  const found = findTodoInClient(fresh, args.todoId, {
    cycleStart: args.cycleStart,
    categoryKey: args.categoryKey,
  });
  if (!found) {
    const err = new Error('Todo not found. Pass todoId from list_open_todos.');
    err.code = 'not_found';
    throw err;
  }

  const subtaskId = String(args.subtaskId || '').trim();
  if (subtaskId) {
    const cycles = { ...(fresh.todoCycles || {}) };
    const cycleData = { ...(cycles[found.cycleKey] || {}) };
    const catTodo = cycleData[found.categoryKey] || { closed: false, items: [] };
    const hasSub = (found.item.subtasks || []).some((s) => s?.id === subtaskId);
    if (!hasSub) {
      const err = new Error('Subtask not found on that todo.');
      err.code = 'not_found';
      throw err;
    }
    const items = setSubtaskDoneInItems(
      Array.isArray(catTodo.items) ? [...catTodo.items] : [],
      found.item.id,
      subtaskId,
      done,
    );
    cycleData[found.categoryKey] = { ...catTodo, items };
    cycles[found.cycleKey] = cycleData;
    await writeTodoCycles(fresh, cycles);
    return {
      ok: true,
      clientId: client.id,
      clientName: client.name,
      todoId: found.item.id,
      subtaskId,
      done,
      scope: 'subtask',
    };
  }

  if (done && !canMarkParentTodoDone(found.item)) {
    const open = (found.item.subtasks || []).filter((s) => !s?.done).length;
    const err = new Error(
      `Complete every sub-task first (${open} still open), or pass subtaskId to complete a subtask.`,
    );
    err.code = 'subtasks_open';
    throw err;
  }

  let cycles = { ...(fresh.todoCycles || {}) };
  if (done) {
    let recurringSkipKey = '';
    if (found.item.recurring) {
      recurringSkipKey = recurringAnchorKey(
        found.item.recurringId || found.item.id,
        found.item.dueDate,
      );
    }
    const { cycles: marked, touched } = markPrimaryTodoDoneAcrossCycles(
      cycles,
      found.categoryKey,
      found.item.id,
      true,
      { recurringSkipKey },
    );
    if (!touched) {
      const err = new Error('Could not mark todo complete across cycles.');
      err.code = 'write_failed';
      throw err;
    }
    cycles = marked;
  } else {
    const cycleData = { ...(cycles[found.cycleKey] || {}) };
    const catTodo = cycleData[found.categoryKey] || { closed: false, items: [] };
    const items = (Array.isArray(catTodo.items) ? catTodo.items : []).map((row) =>
      row.id === found.item.id ? { ...row, done: false, doneAt: null } : row,
    );
    cycleData[found.categoryKey] = { ...catTodo, items };
    cycles[found.cycleKey] = cycleData;
  }

  await writeTodoCycles(fresh, cycles);

  if (done) {
    try {
      await writeClientActivity({
        clientId: client.id,
        clientName: client.name || '',
        type: 'task_completed',
        title:
          String(found.item.text || 'Task completed').trim() || 'Task completed',
        body: `Category: ${found.categoryKey}`,
        actorEmail,
        source: 'system',
        meta: {
          source: 'perplexity_mcp',
          todoId: found.item.id,
          categoryKey: found.categoryKey,
          cycleStart: found.cycleStart,
        },
      });
    } catch (err) {
      console.warn('[mcp-write] activity complete:', err?.message || err);
    }
  }

  return {
    ok: true,
    clientId: client.id,
    clientName: client.name,
    todoId: found.item.id,
    categoryKey: found.categoryKey,
    cycleStart: found.cycleStart,
    done,
    scope: 'primary',
  };
}

export async function updateTodoDueDate(client, args = {}) {
  assertActiveClient(client);
  const actorEmail = resolveMcpActorEmail(args.actorEmail);
  const clear =
    args.dueDate === null ||
    args.dueDate === '' ||
    String(args.dueDate || '').toLowerCase() === 'clear';
  const nextDue = clear ? null : parseDueDateMs(args.dueDate);
  if (!clear && nextDue == null) {
    const err = new Error('dueDate must be an ISO date/ms, or null/"clear" to remove.');
    err.code = 'bad_request';
    throw err;
  }

  const db = await getDigestDb();
  const fresh = (await fetchDoc(db, `clients/${client.id}`)) || client;
  const found = findTodoInClient(fresh, args.todoId, {
    cycleStart: args.cycleStart,
    categoryKey: args.categoryKey,
  });
  if (!found) {
    const err = new Error('Todo not found.');
    err.code = 'not_found';
    throw err;
  }

  let updated = { ...found.item, dueDate: nextDue };
  updated = clampAllSubtaskDueDatesToParent(updated);

  const cycles = { ...(fresh.todoCycles || {}) };
  const cycleData = { ...(cycles[found.cycleKey] || {}) };
  const catTodo = cycleData[found.categoryKey] || { closed: false, items: [] };
  const items = (Array.isArray(catTodo.items) ? catTodo.items : []).map((i) =>
    i.id === found.item.id ? updated : i,
  );
  cycleData[found.categoryKey] = { ...catTodo, items };
  cycles[found.cycleKey] = cycleData;
  await writeTodoCycles(fresh, cycles);

  try {
    await writeClientActivity({
      clientId: client.id,
      clientName: client.name || '',
      type: 'todo_created',
      title: 'Task due date updated (Perplexity)',
      body: nextDue ? new Date(nextDue).toISOString() : 'cleared',
      actorEmail,
      source: 'system',
      meta: {
        source: 'perplexity_mcp',
        todoId: found.item.id,
        dueDate: nextDue,
      },
    });
  } catch (err) {
    console.warn('[mcp-write] activity due date:', err?.message || err);
  }

  return {
    ok: true,
    clientId: client.id,
    clientName: client.name,
    todoId: found.item.id,
    dueDate: nextDue,
    subtasks: (updated.subtasks || []).map((s) => ({
      id: s.id,
      dueDate: s.dueDate,
    })),
  };
}

export async function logTime(client, args = {}) {
  assertActiveClient(client);
  const { categoryLabel } = resolveRetainerCategory(client, args);
  const actorEmail = resolveMcpActorEmail(args.actorEmail);
  const { startMs, endMs, durationMs } = resolveDurationMs(args);
  const employeeName =
    String(args.employeeName || '').trim() || actorEmail || 'Perplexity MCP';
  const notes = String(args.notes || '').trim().slice(0, 4000);
  const userId = String(args.userId || '').trim() || 'manual';

  const db = await getDigestDb();
  const shiftId = await createDoc(db, 'timesheets', {
    employeeName,
    clockInTime: startMs,
    clockOutTime: endMs,
    duration: durationMs,
    totalSavedDuration: durationMs,
    status: 'completed',
    userId,
    isManual: true,
    source: 'perplexity_mcp',
  });

  const taskLogId = await createDoc(db, 'taskLogs', {
    shiftId,
    userId,
    clientName: client.name || '',
    clientId: client.id,
    projectName: categoryLabel,
    projectId: null,
    clockInTime: startMs,
    clockOutTime: endMs,
    duration: durationMs,
    totalSavedDuration: durationMs,
    status: 'completed',
    notes,
    isManual: true,
    source: 'perplexity_mcp',
  });

  try {
    await writeClientActivity({
      clientId: client.id,
      clientName: client.name || '',
      type: 'time_logged',
      title: 'Time logged (Perplexity)',
      body: `${(durationMs / 3600000).toFixed(2)}h · ${categoryLabel}${notes ? ` — ${notes.slice(0, 200)}` : ''}`,
      actorEmail,
      source: 'system',
      meta: {
        source: 'perplexity_mcp',
        taskLogId,
        shiftId,
        category: categoryLabel,
        durationMs,
      },
    });
  } catch (err) {
    console.warn('[mcp-write] activity time:', err?.message || err);
  }

  return {
    ok: true,
    clientId: client.id,
    clientName: client.name,
    category: categoryLabel,
    taskLogId,
    shiftId,
    hours: Number((durationMs / 3600000).toFixed(4)),
    startTime: startMs,
    endTime: endMs,
    notes: notes || null,
  };
}

async function writeExpenseRow(client, args, { creditsMode = false } = {}) {
  assertActiveClient(client);
  const { categoryLabel } = resolveRetainerCategory(client, args);
  const actorEmail = resolveMcpActorEmail(args.actorEmail);
  const db = await getDigestDb();
  const fx = await loadFxToCad(db);
  const computed = computeExpenseAmounts({
    amount: creditsMode ? undefined : args.amount,
    currency: args.currency || 'CAD',
    credits: creditsMode ? args.credits : args.credits || null,
    applyMarkup: args.applyMarkup !== false,
    hourlyRate: client.hourlyRate || 0,
    categoryLabel,
    client,
    fxToCad: fx,
  });

  if (creditsMode && !computed.isPerplexity) {
    const err = new Error('credits is required for log_perplexity_credits.');
    err.code = 'bad_request';
    throw err;
  }

  const dateMs =
    parseDueDateMs(args.date) ||
    (() => {
      const now = new Date();
      return new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        12,
        0,
        0,
        0,
      ).getTime();
    })();

  const userDescription = String(args.description || '').trim();
  const description = computed.isPerplexity
    ? buildPerplexityExpenseDescription(
        computed.perplexityCredits,
        userDescription,
      )
    : userDescription || 'Expense (Perplexity)';

  const expense = {
    clientId: client.id,
    clientName: client.name || '',
    category: categoryLabel,
    projectId: null,
    description: description.slice(0, 2000),
    rawAmount: computed.rawAmount,
    finalCost: computed.finalCost,
    equivalentHours: computed.equivalentHours,
    date: dateMs,
    originalCurrency: computed.originalCurrency,
    originalAmount: computed.originalAmount,
    source: 'perplexity_mcp',
  };
  if (computed.perplexityCredits != null) {
    expense.perplexityCredits = computed.perplexityCredits;
  }
  if (computed.fxRateToCad != null && computed.originalCurrency !== 'CAD') {
    expense.fxRateToCad = computed.fxRateToCad;
    expense.fxSource = 'settings/fxRates';
  }

  const expenseId = await createDoc(db, 'expenses', expense);

  try {
    await writeClientActivity({
      clientId: client.id,
      clientName: client.name || '',
      type: 'expense_logged',
      title: computed.isPerplexity
        ? 'Perplexity credits logged'
        : 'Expense logged (Perplexity)',
      body: clip(description, 500),
      actorEmail,
      source: 'system',
      meta: {
        source: 'perplexity_mcp',
        expenseId,
        category: categoryLabel,
        finalCost: computed.finalCost,
        perplexityCredits: computed.perplexityCredits,
      },
    });
  } catch (err) {
    console.warn('[mcp-write] activity expense:', err?.message || err);
  }

  return {
    ok: true,
    clientId: client.id,
    clientName: client.name,
    expenseId,
    category: categoryLabel,
    description,
    rawAmount: Number(computed.rawAmount.toFixed(4)),
    finalCost: Number(computed.finalCost.toFixed(4)),
    equivalentHours: Number(computed.equivalentHours.toFixed(4)),
    originalCurrency: computed.originalCurrency,
    originalAmount: computed.originalAmount,
    perplexityCredits: computed.perplexityCredits,
    date: dateMs,
  };
}

export async function logExpense(client, args = {}) {
  if (args.credits != null && args.credits !== '' && !(Number(args.amount) > 0)) {
    return writeExpenseRow(client, args, { creditsMode: true });
  }
  return writeExpenseRow(client, args, { creditsMode: false });
}

export async function logPerplexityCredits(client, args = {}) {
  return writeExpenseRow(client, args, { creditsMode: true });
}

export async function linkDocument(client, args = {}) {
  assertActiveClient(client);
  const actorEmail = resolveMcpActorEmail(args.actorEmail);
  const url = String(args.url || '').trim();
  const driveFileId =
    extractDriveFileId(args.driveFileId) || extractDriveFileId(url);
  // Do not use args.name — that is the client name resolver field.
  const name =
    String(args.label || args.fileName || args.documentName || '').trim() ||
    (driveFileId ? 'Drive file' : 'Linked document');

  if (!driveFileId && !url) {
    const err = new Error('Provide a Drive file id or a document URL.');
    err.code = 'bad_request';
    throw err;
  }

  const db = await getDigestDb();
  const fresh = (await fetchDoc(db, `clients/${client.id}`)) || client;

  let linkedTodoId = String(args.todoId || '').trim() || null;
  let linkedTodoText = null;
  let linkedCategoryKey = null;
  let linkedCycleStart = null;
  let found = null;
  if (linkedTodoId) {
    found = findTodoInClient(fresh, linkedTodoId, {
      cycleStart: args.cycleStart,
      categoryKey: args.categoryKey,
    });
    if (!found) {
      const err = new Error('todoId not found on this client.');
      err.code = 'not_found';
      throw err;
    }
    if (getTodoAttachments(found.item).length >= MAX_TODO_ATTACHMENTS) {
      const err = new Error(
        `Maximum ${MAX_TODO_ATTACHMENTS} attachments per task.`,
      );
      err.code = 'too_many';
      throw err;
    }
    linkedTodoText = found.item.text || null;
    linkedCategoryKey = found.categoryKey;
    linkedCycleStart = found.cycleStart;
  }

  let record;
  if (driveFileId) {
    record = buildDriveDocumentRecord({
      driveFile: {
        id: driveFileId,
        name,
        mimeType: args.mimeType || 'application/octet-stream',
        size: Number(args.sizeBytes || 0),
        webViewLink:
          url || `https://drive.google.com/file/d/${driveFileId}/view`,
      },
      uploadedBy: actorEmail,
      linkedTodoId,
      linkedTodoText,
      linkedCategoryKey,
      linkedCycleStart,
    });
  } else {
    record = buildClientDocumentRecord({
      id: newDocumentId(),
      name,
      url,
      contentType: args.mimeType || 'text/uri-list',
      sizeBytes: 0,
      uploadedBy: actorEmail,
      linkedTodoId,
      linkedTodoText,
      linkedCategoryKey,
      linkedCycleStart,
      source: 'link',
    });
  }

  const existingDocs = Array.isArray(fresh.documents) ? fresh.documents : [];
  const documents = existingDocs.some(
    (d) => d.id === record.id || (record.driveFileId && d.driveFileId === record.driveFileId),
  )
    ? existingDocs
    : [...existingDocs, record];

  const patch = { documents };

  // Also add a pinnedDocs bookmark for plain URL links (shown on client profile).
  if (!driveFileId && url) {
    const pinned = Array.isArray(fresh.pinnedDocs) ? [...fresh.pinnedDocs] : [];
    const already = pinned.some(
      (p) => String(p.url || '').trim() === url || String(p.label || '') === name,
    );
    if (!already) {
      pinned.push({
        id: `pin_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        label: name,
        url,
      });
      patch.pinnedDocs = pinned;
    }
  }

  if (found && linkedTodoId && linkedCategoryKey != null && linkedCycleStart != null) {
    const cycles = { ...(fresh.todoCycles || {}) };
    const cycleKey = String(linkedCycleStart);
    const cycleData = { ...(cycles[cycleKey] || {}) };
    const catTodo = cycleData[linkedCategoryKey];
    if (catTodo?.items) {
      const nextItems = catTodo.items.map((item) => {
        if (item.id !== linkedTodoId) return item;
        const already = getTodoAttachments(item).some(
          (a) => a.id === record.id || a.driveFileId === record.driveFileId,
        );
        return already ? item : addAttachmentToItem(item, record);
      });
      cycleData[linkedCategoryKey] = { ...catTodo, items: nextItems };
      cycles[cycleKey] = cycleData;
      patch.todoCycles = cycles;
      Object.assign(
        patch,
        buildTeamAccessMergeForTodoAssignees(fresh, cycles),
      );
    }
  }

  await mergeDoc(db, `clients/${client.id}`, patch);

  try {
    await writeClientActivity({
      clientId: client.id,
      clientName: client.name || '',
      type: 'file_upload',
      title: `Document linked (Perplexity): ${record.name}`,
      body: linkedTodoText ? `Attached to task: ${linkedTodoText}` : url || '',
      actorEmail,
      source: 'system',
      meta: {
        source: 'perplexity_mcp',
        documentId: record.id,
        driveFileId: record.driveFileId || null,
        linkedTodoId,
      },
    });
  } catch (err) {
    console.warn('[mcp-write] activity document:', err?.message || err);
  }

  return {
    ok: true,
    clientId: client.id,
    clientName: client.name,
    document: {
      id: record.id,
      name: record.name,
      url: record.url,
      driveFileId: record.driveFileId || null,
      linkedTodoId,
    },
  };
}

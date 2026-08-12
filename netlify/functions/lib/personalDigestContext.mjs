/**
 * Builds per-staff morning digest sections from clients, notifications, and deals.
 */

import { getBillingPeriod } from '../../../src/utils/billingEngine.js';
import { getTaskComments } from '../../../src/utils/taskComments.js';
import { getSubtasks } from '../../../src/utils/todoSubtasks.js';
import { NOTIFICATION_TYPES } from '../../../src/utils/notifications.js';
import {
  buildSalesFollowUpHints,
  listSalesDealsForCoach,
} from '../../../src/utils/salesAiPayload.js';
import { resolvePipelineStages } from '../../../src/utils/salesPipeline.js';
import { getTodoStateForCycle } from './workspaceDigestContext.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

function normEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function startOfTorontoDayMs(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(now));
  const y = Number(parts.find((p) => p.type === 'year')?.value);
  const m = Number(parts.find((p) => p.type === 'month')?.value);
  const d = Number(parts.find((p) => p.type === 'day')?.value);
  // Approximate Toronto midnight in UTC using noon offset then subtract local hours — use
  // a fixed -4/-5 via Date parsing of the Toronto calendar date at 00:00 EST/EDT is hard;
  // compare due dates as YMD strings instead for reliability.
  return { y, m, d, ymd: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` };
}

function msToYmdToronto(ms) {
  if (!ms) return null;
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
}

function ymdCompare(a, b) {
  if (!a || !b) return 0;
  return String(a).localeCompare(String(b));
}

function addDaysYmd(ymd, days) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function assigneesOf(item) {
  return (Array.isArray(item?.assigneeEmails) ? item.assigneeEmails : [])
    .map(normEmail)
    .filter(Boolean);
}

function walkAssignedOpenTasks(clients, email) {
  const me = normEmail(email);
  const rows = [];
  for (const client of clients || []) {
    if (!client || client.archived || client.status === 'paused') continue;
    const period = getBillingPeriod(client.billingDay || 1, 0);
    const state = getTodoStateForCycle(client, period.start) || {};
    for (const [categoryKey, cat] of Object.entries(state)) {
      for (const item of cat?.items || []) {
        if (!item || item.done) continue;
        const pushIfMine = (node, isStep) => {
          if (!node || node.done) return;
          if (!assigneesOf(node).includes(me)) return;
          rows.push({
            clientId: client.id,
            clientName: client.name,
            categoryKey,
            itemId: node.id,
            parentId: isStep ? item.id : null,
            text: node.text || (isStep ? 'Untitled step' : 'Untitled task'),
            dueYmd: msToYmdToronto(node.dueDate),
            dueMs: Number(node.dueDate || 0) || null,
            isStep: !!isStep,
          });
        };
        pushIfMine(item, false);
        for (const sub of getSubtasks(item)) pushIfMine(sub, true);
      }
    }
  }
  return rows;
}

function collectMentionsFromTodos(clients, email, sinceMs) {
  const me = normEmail(email);
  const rows = [];
  for (const client of clients || []) {
    if (!client || client.archived) continue;
    const period = getBillingPeriod(client.billingDay || 1, 0);
    const state = getTodoStateForCycle(client, period.start) || {};
    for (const [categoryKey, cat] of Object.entries(state)) {
      for (const item of cat?.items || []) {
        if (!item) continue;
        const scan = (node) => {
          for (const c of getTaskComments(node)) {
            const at = Number(c.createdAt || 0);
            if (sinceMs && at < sinceMs) continue;
            const mentions = Array.isArray(c.mentions)
              ? c.mentions.map(normEmail)
              : [];
            if (!mentions.includes(me)) continue;
            rows.push({
              clientName: client.name,
              categoryKey,
              itemText: node.text || 'Task',
              authorName: c.authorName || c.authorEmail || 'Teammate',
              text: c.text || '',
              createdAt: at,
            });
          }
        };
        scan(item);
        for (const sub of getSubtasks(item)) scan(sub);
      }
    }
  }
  return rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/**
 * @returns {{ email, displayName, salesFunnel, sections, hasContent }}
 */
export function buildPersonalDigestForUser({
  email,
  adminDoc = {},
  clients = [],
  notifications = [],
  deals = [],
  leads = [],
  salesPipeline = null,
  period = 'daily',
  now = Date.now(),
} = {}) {
  const me = normEmail(email);
  const today = startOfTorontoDayMs(now);
  const lookbackDays = period === 'weekly' ? 7 : 1;
  const dueSoonDays = period === 'weekly' ? 7 : 3;
  const sinceMs = now - lookbackDays * DAY_MS;
  const dueSoonEnd = addDaysYmd(today.ymd, dueSoonDays);

  const assigned = walkAssignedOpenTasks(clients, me);
  const overdue = assigned
    .filter((t) => t.dueYmd && ymdCompare(t.dueYmd, today.ymd) < 0)
    .sort((a, b) => ymdCompare(a.dueYmd, b.dueYmd));
  const dueSoon = assigned
    .filter(
      (t) =>
        t.dueYmd &&
        ymdCompare(t.dueYmd, today.ymd) >= 0 &&
        ymdCompare(t.dueYmd, dueSoonEnd) <= 0,
    )
    .sort((a, b) => ymdCompare(a.dueYmd, b.dueYmd));

  const myNotifs = (notifications || []).filter(
    (n) => normEmail(n.recipientEmail) === me && Number(n.createdAt || 0) >= sinceMs,
  );
  const newAssignments = myNotifs
    .filter((n) => n.type === NOTIFICATION_TYPES.TASK_ASSIGNED)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const mentionNotifs = myNotifs
    .filter((n) => n.type === NOTIFICATION_TYPES.MENTION)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const mentionComments = collectMentionsFromTodos(clients, me, sinceMs);
  // Prefer notification rows; fall back to comment scan if inbox empty.
  const mentions = mentionNotifs.length
    ? mentionNotifs.map((n) => ({
        clientName: n.clientName || '',
        itemText: n.title || 'Task',
        authorName: n.actorName || n.actorEmail || 'Teammate',
        text: n.body || '',
        createdAt: n.createdAt,
      }))
    : mentionComments;

  const salesEnabled = !!adminDoc?.features?.salesFunnel;
  let salesFollowUps = [];
  if (salesEnabled) {
    const stages = resolvePipelineStages(salesPipeline);
    const rows = listSalesDealsForCoach({
      deals,
      leads,
      clients,
      stages,
      adminUsers: [{ email: me, displayName: adminDoc.displayName }],
      mineOnly: true,
      viewerEmail: me,
    });
    salesFollowUps = buildSalesFollowUpHints(rows).slice(0, 8);
  }

  const sections = {
    newAssignments: newAssignments.slice(0, 20).map((n) => ({
      title: n.title || 'Task assigned',
      body: n.body || '',
      clientName: n.clientName || '',
      createdAt: n.createdAt,
    })),
    overdue: overdue.slice(0, 20),
    dueSoon: dueSoon.slice(0, 20),
    mentions: mentions.slice(0, 20),
    salesFollowUps,
  };

  const hasContent = Boolean(
    sections.newAssignments.length ||
      sections.overdue.length ||
      sections.dueSoon.length ||
      sections.mentions.length ||
      sections.salesFollowUps.length,
  );

  return {
    email: me,
    displayName: adminDoc.displayName || me.split('@')[0],
    salesFunnel: salesEnabled,
    period,
    todayYmd: today.ymd,
    sections,
    hasContent,
  };
}

export function buildAssignmentAlertForUser({
  email,
  notifications = [],
  sinceMs,
} = {}) {
  const me = normEmail(email);
  const items = (notifications || [])
    .filter(
      (n) =>
        normEmail(n.recipientEmail) === me &&
        n.type === NOTIFICATION_TYPES.TASK_ASSIGNED &&
        Number(n.createdAt || 0) > Number(sinceMs || 0),
    )
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return {
    email: me,
    items: items.map((n) => ({
      title: n.title || 'New task assigned',
      body: n.body || '',
      clientName: n.clientName || '',
      createdAt: n.createdAt,
    })),
  };
}

/**
 * Builds per-staff morning digest sections from clients, notifications, and deals.
 */

import { getBillingPeriod } from '../../../src/utils/billingEngine.js';
import { isClientActiveForWork } from '../../../src/utils/clientActiveForWork.js';
import { extractItemAssigneeEmails } from '../../../src/utils/teamClientAccess.js';
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
/** Ignore HubSpot-era close dates that would otherwise flood every digest. */
const DIGEST_MAX_DAYS_PAST_CLOSE = 45;
const DIGEST_MAX_DAYS_IDLE = 90;
const DIGEST_SALES_LIMIT = 4;

function normEmail(value) {
  return String(value || '').trim().toLowerCase();
}

/** Explicit assignees only (incl. legacy assigneeEmail) — not the kiosk “unassigned = mine” fallback. */
function nodeAssignedTo(node, parentItem, email) {
  const me = normEmail(email);
  if (!me || !node) return false;
  const mine = extractItemAssigneeEmails(node);
  if (mine.length) return mine.includes(me);
  if (parentItem) {
    const parent = extractItemAssigneeEmails(parentItem);
    return parent.includes(me);
  }
  return false;
}

/** Sales hints suitable for email — drop ancient import noise. */
function digestSalesFollowUps(dealRows) {
  const byId = new Map((dealRows || []).map((d) => [d.id, d]));
  return buildSalesFollowUpHints(dealRows)
    .filter((h) => {
      const d = byId.get(h.dealId);
      if (!d) return false;
      if ((d.daysPastClose || 0) > DIGEST_MAX_DAYS_PAST_CLOSE) return false;
      if ((d.daysIdle || 0) > DIGEST_MAX_DAYS_IDLE) return false;
      return true;
    })
    .slice(0, DIGEST_SALES_LIMIT);
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

function walkAssignedOpenTasks(clients, email, options = {}) {
  const me = normEmail(email);
  const {
    includeUnassignedDue = false,
    todayYmd = null,
    dueSoonEndYmd = null,
  } = options;
  const rows = [];
  for (const client of clients || []) {
    if (!isClientActiveForWork(client)) continue;
    const period = getBillingPeriod(client.billingDay || 1, 0);
    const state = getTodoStateForCycle(client, period.start) || {};
    for (const [categoryKey, cat] of Object.entries(state)) {
      for (const item of cat?.items || []) {
        if (!item || item.done) continue;
        const pushIfMine = (node, isStep) => {
          if (!node || node.done) return;
          const explicit = nodeAssignedTo(node, isStep ? item : null, me);
          if (!explicit) {
            // Managers: surface unassigned work only when it has a near-term due date.
            if (!includeUnassignedDue || isStep) return;
            if (extractItemAssigneeEmails(node).length > 0) return;
            const dueYmd = msToYmdToronto(node.dueDate);
            if (
              !dueYmd ||
              !todayYmd ||
              !dueSoonEndYmd ||
              ymdCompare(dueYmd, dueSoonEndYmd) > 0
            ) {
              return;
            }
          }
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
  const role = String(adminDoc?.role || '').toLowerCase();
  // Admins/billing also get unassigned tasks that are overdue / due soon
  // (matches how the kiosk "mine" filter treats empty assignee lists for managers).
  const includeUnassignedDue = role === 'admin' || role === 'billing';

  const assigned = walkAssignedOpenTasks(clients, me, {
    includeUnassignedDue,
    todayYmd: today.ymd,
    dueSoonEndYmd: dueSoonEnd,
  });
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
  // Everything else still assigned & open (no due date, or due past the
  // "soon" window). Without this, digests looked sales-only whenever tasks
  // lacked near-term due dates.
  const overdueIds = new Set(overdue.map((t) => `${t.clientId}:${t.itemId}`));
  const dueSoonIds = new Set(dueSoon.map((t) => `${t.clientId}:${t.itemId}`));
  const openAssigned = assigned
    .filter((t) => {
      const key = `${t.clientId}:${t.itemId}`;
      return !overdueIds.has(key) && !dueSoonIds.has(key);
    })
    .sort((a, b) => {
      if (!a.dueYmd && b.dueYmd) return -1;
      if (a.dueYmd && !b.dueYmd) return 1;
      return ymdCompare(a.dueYmd, b.dueYmd) || String(a.clientName).localeCompare(String(b.clientName));
    });

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
    salesFollowUps = digestSalesFollowUps(rows);
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
    openAssigned: openAssigned.slice(0, 25),
    mentions: mentions.slice(0, 20),
    salesFollowUps,
  };

  const hasContent = Boolean(
    sections.newAssignments.length ||
      sections.overdue.length ||
      sections.dueSoon.length ||
      sections.openAssigned.length ||
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

/**
 * Builds per-staff morning digest sections from clients, notifications, and deals.
 */

import { getBillingPeriod } from '../../../src/utils/billingEngine.js';
import { isClientActiveForWork } from '../../../src/utils/clientActiveForWork.js';
import {
  clientHasEnabledRetainers,
  getEnabledRetainerCategoryNames,
  isRetainerCategoryDollar,
} from '../../../src/utils/retainerCategories.js';
import {
  extractItemAssigneeEmails,
  teamMemberCanViewClient,
} from '../../../src/utils/teamClientAccess.js';
import { getTaskComments } from '../../../src/utils/taskComments.js';
import { getSubtasks } from '../../../src/utils/todoSubtasks.js';
import { NOTIFICATION_TYPES } from '../../../src/utils/notifications.js';
import { isSuperAdminUser } from '../../../src/utils/staffDirectory.js';
import {
  buildSalesFollowUpHints,
  listSalesDealsForCoach,
} from '../../../src/utils/salesAiPayload.js';
import { resolvePipelineStages } from '../../../src/utils/salesPipeline.js';
import { getTodoStateForCycle } from './workspaceDigestContext.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Ignore HubSpot-era close dates that would otherwise flood every digest. */
const DIGEST_MAX_DAYS_PAST_CLOSE = 21;
const DIGEST_MAX_DAYS_IDLE = 60;
const DIGEST_SALES_LIMIT = 4;

function normEmail(value) {
  return String(value || '').trim().toLowerCase();
}

/** Firestore Timestamps / {seconds} / number → ms. */
function toMs(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value?.toMillis === 'function') {
    const n = value.toMillis();
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function pushEmail(set, value) {
  if (!value) return;
  if (typeof value === 'string') {
    const e = normEmail(value);
    if (e.includes('@')) set.add(e);
    return;
  }
  if (typeof value === 'object') {
    pushEmail(set, value.email || value.value || value.id);
  }
}

/** Explicit assignees, including object-shaped picker values. */
function assigneesOf(node) {
  const set = new Set(extractItemAssigneeEmails(node));
  if (Array.isArray(node?.assigneeEmails)) {
    for (const v of node.assigneeEmails) pushEmail(set, v);
  }
  pushEmail(set, node?.assigneeEmail);
  pushEmail(set, node?.assignee);
  return [...set];
}

/** Explicit assignees only (incl. legacy assigneeEmail) — not the kiosk “unassigned = mine” fallback. */
function nodeAssignedTo(node, parentItem, email) {
  const me = normEmail(email);
  if (!me || !node) return false;
  const mine = assigneesOf(node);
  if (mine.length) return mine.includes(me);
  if (parentItem) return assigneesOf(parentItem).includes(me);
  return false;
}

function itemsOf(cat) {
  if (!cat || typeof cat !== 'object') return [];
  if (Array.isArray(cat.items)) return cat.items;
  if (cat.items && typeof cat.items === 'object') return Object.values(cat.items);
  return [];
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
  const n = toMs(ms);
  if (!n || n <= 0) return null;
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

function formatRetainerQty(value, isDollar) {
  const n = Number(value) || 0;
  if (isDollar) {
    return `$${Math.round(n).toLocaleString('en-US')}`;
  }
  const rounded = Math.abs(n) >= 10 ? n.toFixed(0) : n.toFixed(1);
  return `${rounded}h`;
}

/**
 * Retainers ending soon with unused balance, plus over-budget lines.
 * Admins/billing see every active client; others only clients they can access.
 */
function buildRetainerWatchouts({
  clients = [],
  getGlobalRetainerStats,
  email,
  adminDoc = {},
  period = 'daily',
  now = Date.now(),
} = {}) {
  const unusedBalance = [];
  const overBudget = [];
  if (typeof getGlobalRetainerStats !== 'function') {
    return { unusedBalance, overBudget };
  }
  const me = normEmail(email);
  const role = String(adminDoc?.role || '').toLowerCase();
  const seeAll =
    isSuperAdminUser({ email: me }, role) || role === 'billing';
  const soonDays = period === 'weekly' ? 14 : 7;

  for (const client of clients || []) {
    if (!isClientActiveForWork(client) || !clientHasEnabledRetainers(client)) continue;
    if (!seeAll && !teamMemberCanViewClient(client, me)) continue;
    let stats = null;
    let billing = null;
    try {
      billing = getBillingPeriod(client.billingDay || 1, 0);
      stats = getGlobalRetainerStats(client, billing.start, billing.end);
    } catch {
      continue;
    }
    if (!billing || !stats) continue;
    const daysLeft = Math.max(0, Math.ceil((billing.end - now) / DAY_MS));
    const cycleEndYmd = msToYmdToronto(billing.end);

    for (const cat of getEnabledRetainerCategoryNames(client)) {
      const pc = stats?.perCategory?.[cat];
      if (!pc) continue;
      const isDollar = isRetainerCategoryDollar(client, cat);
      const allotted = Number(pc.adjustedAllotted ?? 0);
      const used = Number(pc.used ?? 0);
      const remaining = allotted - used;
      const eps = isDollar ? 0.02 : 0.03;
      const over = allotted > eps ? used > allotted + eps : used > eps;
      const hasAvailable = remaining > eps;
      const row = {
        clientName: client.name,
        category: cat,
        daysLeft,
        cycleEndYmd,
        allotted,
        used,
        remaining,
        isDollar,
        remainingLabel: formatRetainerQty(remaining, isDollar),
        allottedLabel: formatRetainerQty(allotted, isDollar),
        usedLabel: formatRetainerQty(used, isDollar),
      };
      if (over) overBudget.push(row);
      else if (hasAvailable && daysLeft <= soonDays) unusedBalance.push(row);
    }
  }

  unusedBalance.sort(
    (a, b) => a.daysLeft - b.daysLeft || b.remaining - a.remaining,
  );
  overBudget.sort((a, b) => a.daysLeft - b.daysLeft);
  return {
    unusedBalance: unusedBalance.slice(0, 15),
    overBudget: overBudget.slice(0, 10),
  };
}

/**
 * Walk every stored billing cycle, not only "current".
 * Netlify runs in UTC while cycle keys are written from the browser's local
 * timezone (America/Toronto), so getBillingPeriod() on the server often misses
 * the map key and returns an empty virtual cycle — which looked like "no tasks".
 */
function forEachClientTodoState(clients, visit) {
  for (const client of clients || []) {
    if (!isClientActiveForWork(client)) continue;
    const cycles = client.todoCycles && typeof client.todoCycles === 'object' ? client.todoCycles : {};
    const seen = new Set();
    for (const [cycleKey, state] of Object.entries(cycles)) {
      if (!state || typeof state !== 'object') continue;
      seen.add(String(cycleKey));
      visit(client, state, cycleKey);
    }
    try {
      const period = getBillingPeriod(client.billingDay || 1, 0);
      const currentKey = String(period.start);
      if (!seen.has(currentKey)) {
        visit(client, getTodoStateForCycle(client, period.start) || {}, currentKey);
      }
    } catch {
      // Virtual current cycle is optional; stored cycles above are the source of truth.
    }
  }
}

function walkAssignedOpenTasks(clients, email, options = {}) {
  const me = normEmail(email);
  const {
    includeUnassignedDue = false,
    todayYmd = null,
    dueSoonEndYmd = null,
  } = options;
  const rows = [];
  const seenItem = new Set();
  forEachClientTodoState(clients, (client, state, cycleKey) => {
    for (const [categoryKey, cat] of Object.entries(state || {})) {
      for (const item of itemsOf(cat)) {
        if (!item || item.done) continue;
        const pushIfMine = (node, isStep) => {
          if (!node || node.done) return;
          const explicit = nodeAssignedTo(node, isStep ? item : null, me);
          if (!explicit) {
            if (!includeUnassignedDue || isStep) return;
            if (assigneesOf(node).length > 0) return;
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
          const itemId = node.id || `${cycleKey}:${categoryKey}:${node.text || ''}`;
          const key = `${client.id}:${itemId}`;
          if (seenItem.has(key)) return;
          seenItem.add(key);
          rows.push({
            clientId: client.id,
            clientName: client.name,
            categoryKey,
            itemId,
            parentId: isStep ? item.id : null,
            text: node.text || (isStep ? 'Untitled step' : 'Untitled task'),
            dueYmd: msToYmdToronto(node.dueDate),
            dueMs: toMs(node.dueDate) || null,
            isStep: !!isStep,
          });
        };
        pushIfMine(item, false);
        for (const sub of getSubtasks(item)) pushIfMine(sub, true);
      }
    }
  });
  return rows;
}

function digestTaskDebug(clients, email) {
  const me = normEmail(email);
  let activeClients = 0;
  let cycleCount = 0;
  let openItems = 0;
  let assignedOpen = 0;
  const sampleAssignees = new Set();
  for (const client of clients || []) {
    if (!isClientActiveForWork(client)) continue;
    activeClients += 1;
    const cycles = client.todoCycles && typeof client.todoCycles === 'object' ? client.todoCycles : {};
    cycleCount += Object.keys(cycles).length;
    for (const state of Object.values(cycles)) {
      if (!state || typeof state !== 'object') continue;
      for (const cat of Object.values(state)) {
        for (const item of itemsOf(cat)) {
          if (!item || item.done) continue;
          openItems += 1;
          const emails = [
            ...assigneesOf(item),
            ...getSubtasks(item).flatMap((s) => (s?.done ? [] : assigneesOf(s))),
          ];
          for (const e of emails) {
            if (sampleAssignees.size < 12) sampleAssignees.add(e);
          }
          if (emails.includes(me) || nodeAssignedTo(item, null, me)) assignedOpen += 1;
        }
      }
    }
  }
  return {
    clientCount: (clients || []).length,
    activeClients,
    cycleCount,
    openItems,
    assignedOpen,
    sampleAssignees: [...sampleAssignees],
  };
}

function collectMentionsFromTodos(clients, email, sinceMs) {
  const me = normEmail(email);
  const rows = [];
  forEachClientTodoState(clients, (client, state) => {
    for (const [categoryKey, cat] of Object.entries(state || {})) {
      for (const item of itemsOf(cat)) {
        if (!item) continue;
        const scan = (node) => {
          for (const c of getTaskComments(node)) {
            const at = toMs(c.createdAt);
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
  });
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
  getGlobalRetainerStats = null,
  period = 'daily',
  now = Date.now(),
} = {}) {
  const me = normEmail(email);
  const today = startOfTorontoDayMs(now);
  const lookbackDays = period === 'weekly' ? 7 : 1;
  const dueSoonDays = period === 'weekly' ? 7 : 3;
  const sinceMs = now - lookbackDays * DAY_MS;
  const dueSoonEnd = addDaysYmd(today.ymd, dueSoonDays);

  const assigned = walkAssignedOpenTasks(clients, me, {
    includeUnassignedDue: false,
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
  const retainers = buildRetainerWatchouts({
    clients,
    getGlobalRetainerStats,
    email: me,
    adminDoc,
    period,
    now,
  });

  const myNotifs = (notifications || []).filter(
    (n) => normEmail(n.recipientEmail) === me && toMs(n.createdAt) >= sinceMs,
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
    unusedRetainers: retainers.unusedBalance,
    overRetainers: retainers.overBudget,
    mentions: mentions.slice(0, 20),
    salesFollowUps,
  };

  const hasContent = Boolean(
    sections.newAssignments.length ||
      sections.overdue.length ||
      sections.dueSoon.length ||
      sections.unusedRetainers.length ||
      sections.overRetainers.length ||
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
    debug: {
      ...digestTaskDebug(clients, me),
      overdue: sections.overdue.length,
      dueSoon: sections.dueSoon.length,
      unusedRetainers: sections.unusedRetainers.length,
      overRetainers: sections.overRetainers.length,
      newAssignments: sections.newAssignments.length,
      mentions: sections.mentions.length,
      sales: sections.salesFollowUps.length,
    },
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
        toMs(n.createdAt) > Number(sinceMs || 0),
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

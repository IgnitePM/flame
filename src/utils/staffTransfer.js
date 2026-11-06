/**
 * Staff offboarding: reassign active work from one staff email to another.
 * Historical attribution (notes authorEmail, actorEmail, timesheets, etc.)
 * is intentionally left alone so past activity still shows the original person.
 */

import { normalizeStaffEmail } from './staffDirectory.js';

export function normalizeTransferEmail(value) {
  return normalizeStaffEmail(value);
}

/** Replace `from` with `to` in an email list; de-dupe; drop empties. */
export function replaceEmailInList(list, fromEmail, toEmail) {
  const from = normalizeTransferEmail(fromEmail);
  const to = normalizeTransferEmail(toEmail);
  if (!from || !to || from === to) {
    return {
      next: Array.isArray(list)
        ? [...new Set(list.map(normalizeTransferEmail).filter(Boolean))]
        : [],
      changed: false,
      replacements: 0,
    };
  }
  const src = Array.isArray(list) ? list : [];
  let replacements = 0;
  const mapped = src.map((raw) => {
    const em = normalizeTransferEmail(raw);
    if (em === from) {
      replacements += 1;
      return to;
    }
    return em;
  });
  const next = [...new Set(mapped.filter(Boolean))];
  const prevNorm = [...new Set(src.map(normalizeTransferEmail).filter(Boolean))];
  const changed =
    replacements > 0 ||
    next.length !== prevNorm.length ||
    next.some((e, i) => e !== prevNorm[i]);
  return { next, changed: changed && (replacements > 0 || next.join() !== prevNorm.join()), replacements };
}

/** Swap a single email field when it matches `from`. */
export function replaceEmailField(value, fromEmail, toEmail) {
  const from = normalizeTransferEmail(fromEmail);
  const to = normalizeTransferEmail(toEmail);
  const cur = normalizeTransferEmail(value);
  if (!from || !to || from === to || !cur || cur !== from) {
    return { next: value == null ? value : String(value), changed: false };
  }
  return { next: to, changed: true };
}

/**
 * Rewrite active assignment fields on a todo / subtask.
 * Does NOT touch comments[].authorEmail or other history fields.
 */
export function rewriteTodoItemAssignments(item, fromEmail, toEmail) {
  if (!item || typeof item !== 'object') {
    return { next: item, changed: false, counts: emptyItemCounts() };
  }
  const counts = emptyItemCounts();
  let next = { ...item };
  let changed = false;

  if (Array.isArray(item.assigneeEmails)) {
    const r = replaceEmailInList(item.assigneeEmails, fromEmail, toEmail);
    if (r.replacements > 0) {
      next.assigneeEmails = r.next;
      counts.assignees += r.replacements;
      changed = true;
    }
  }

  // Legacy single-assignee fields
  for (const key of ['assigneeEmail', 'assignee']) {
    if (item[key] == null || item[key] === '') continue;
    const r = replaceEmailField(item[key], fromEmail, toEmail);
    if (r.changed) {
      next[key] = r.next;
      counts.assignees += 1;
      changed = true;
    }
  }

  if (Array.isArray(item.approvalReviewerEmails)) {
    const r = replaceEmailInList(item.approvalReviewerEmails, fromEmail, toEmail);
    if (r.replacements > 0) {
      next.approvalReviewerEmails = r.next;
      counts.reviewers += r.replacements;
      changed = true;
    }
  }

  if (Array.isArray(item.subtasks) && item.subtasks.length) {
    const subNext = item.subtasks.map((sub) => {
      const rewritten = rewriteTodoItemAssignments(sub, fromEmail, toEmail);
      if (rewritten.changed) {
        changed = true;
        counts.assignees += rewritten.counts.assignees;
        counts.reviewers += rewritten.counts.reviewers;
        counts.subtasks += 1;
      }
      return rewritten.next;
    });
    if (changed) next.subtasks = subNext;
  }

  return { next, changed, counts };
}

function emptyItemCounts() {
  return { assignees: 0, reviewers: 0, subtasks: 0 };
}

function emptyClientCounts() {
  return {
    assignees: 0,
    reviewers: 0,
    subtasks: 0,
    teamAccess: 0,
    itemsTouched: 0,
  };
}

/** Deep-rewrite `todoCycles` assignment emails. */
export function rewriteTodoCyclesAssignments(todoCycles, fromEmail, toEmail) {
  const cycles = todoCycles && typeof todoCycles === 'object' ? todoCycles : {};
  const counts = emptyClientCounts();
  let changed = false;
  const nextCycles = {};

  for (const [cycleKey, cycleData] of Object.entries(cycles)) {
    if (!cycleData || typeof cycleData !== 'object') {
      nextCycles[cycleKey] = cycleData;
      continue;
    }
    const nextCycle = { ...cycleData };
    for (const [catKey, cat] of Object.entries(cycleData)) {
      if (!cat || typeof cat !== 'object' || !Array.isArray(cat.items)) {
        nextCycle[catKey] = cat;
        continue;
      }
      let catChanged = false;
      const nextItems = cat.items.map((item) => {
        const rewritten = rewriteTodoItemAssignments(item, fromEmail, toEmail);
        if (rewritten.changed) {
          catChanged = true;
          changed = true;
          counts.assignees += rewritten.counts.assignees;
          counts.reviewers += rewritten.counts.reviewers;
          counts.subtasks += rewritten.counts.subtasks;
          counts.itemsTouched += 1;
        }
        return rewritten.next;
      });
      nextCycle[catKey] = catChanged ? { ...cat, items: nextItems } : cat;
    }
    nextCycles[cycleKey] = nextCycle;
  }

  return { next: changed ? nextCycles : todoCycles, changed, counts };
}

/**
 * Build a Firestore patch for one client transferring `fromEmail` → `toEmail`.
 * Returns null when nothing changes.
 */
export function buildClientTransferPatch(client, fromEmail, toEmail) {
  const from = normalizeTransferEmail(fromEmail);
  const to = normalizeTransferEmail(toEmail);
  if (!client?.id || !from || !to || from === to) return null;

  const counts = emptyClientCounts();
  const patch = {};

  const cycles = rewriteTodoCyclesAssignments(client.todoCycles, from, to);
  if (cycles.changed) {
    patch.todoCycles = cycles.next;
    counts.assignees += cycles.counts.assignees;
    counts.reviewers += cycles.counts.reviewers;
    counts.subtasks += cycles.counts.subtasks;
    counts.itemsTouched += cycles.counts.itemsTouched;
  }

  const rawAccess = client.teamMemberAccessEmails;
  if (rawAccess != null) {
    const list = Array.isArray(rawAccess)
      ? rawAccess
      : typeof rawAccess === 'string' && rawAccess.trim()
        ? [rawAccess]
        : [];
    const r = replaceEmailInList(list, from, to);
    if (r.replacements > 0) {
      patch.teamMemberAccessEmails = r.next;
      counts.teamAccess += r.replacements;
    }
  }

  if (!Object.keys(patch).length) return null;
  return { clientId: client.id, clientName: client.name || '', patch, counts };
}

export function buildOwnerTransferPatch(docRow, fromEmail, toEmail) {
  const from = normalizeTransferEmail(fromEmail);
  const to = normalizeTransferEmail(toEmail);
  if (!docRow?.id || !from || !to || from === to) return null;
  const r = replaceEmailField(docRow.ownerEmail, from, to);
  if (!r.changed) return null;
  return {
    id: docRow.id,
    patch: { ownerEmail: r.next },
  };
}

/**
 * Plan a full staff transfer against in-memory collections.
 * Notifications are planned separately (need a Firestore query).
 */
export function planStaffTransfer({
  fromEmail,
  toEmail,
  clients = [],
  leads = [],
  deals = [],
  digestRecipients = [],
} = {}) {
  const from = normalizeTransferEmail(fromEmail);
  const to = normalizeTransferEmail(toEmail);
  const errors = [];
  if (!from) errors.push('Choose the staff member to transfer from.');
  if (!to) errors.push('Choose the staff member to transfer to.');
  if (from && to && from === to) {
    errors.push('From and to must be different people.');
  }

  const clientPatches = [];
  const summary = {
    clients: 0,
    taskAssignees: 0,
    reviewers: 0,
    teamAccess: 0,
    leads: 0,
    deals: 0,
    digestRecipients: 0,
  };

  if (!errors.length) {
    for (const client of clients || []) {
      const built = buildClientTransferPatch(client, from, to);
      if (!built) continue;
      clientPatches.push(built);
      summary.clients += 1;
      summary.taskAssignees += built.counts.assignees;
      summary.reviewers += built.counts.reviewers;
      summary.teamAccess += built.counts.teamAccess;
    }
  }

  const leadPatches = [];
  const dealPatches = [];
  if (!errors.length) {
    for (const lead of leads || []) {
      const built = buildOwnerTransferPatch(lead, from, to);
      if (!built) continue;
      leadPatches.push(built);
      summary.leads += 1;
    }
    for (const deal of deals || []) {
      const built = buildOwnerTransferPatch(deal, from, to);
      if (!built) continue;
      dealPatches.push(built);
      summary.deals += 1;
    }
  }

  let nextDigest = Array.isArray(digestRecipients) ? [...digestRecipients] : [];
  if (!errors.length) {
    const r = replaceEmailInList(digestRecipients, from, to);
    if (r.replacements > 0) {
      nextDigest = r.next;
      summary.digestRecipients = r.replacements;
    }
  }

  const total =
    summary.clients +
    summary.leads +
    summary.deals +
    summary.digestRecipients +
    summary.taskAssignees +
    summary.reviewers +
    summary.teamAccess;

  return {
    fromEmail: from,
    toEmail: to,
    errors,
    summary,
    total,
    clientPatches,
    leadPatches,
    dealPatches,
    digestRecipients: nextDigest,
    digestChanged: summary.digestRecipients > 0,
  };
}

export function summarizeTransferPlan(plan, notificationCount = 0) {
  const s = plan?.summary || {};
  const parts = [];
  if (s.taskAssignees) parts.push(`${s.taskAssignees} task assignment${s.taskAssignees === 1 ? '' : 's'}`);
  if (s.reviewers) parts.push(`${s.reviewers} approval reviewer${s.reviewers === 1 ? '' : 's'}`);
  if (s.teamAccess) parts.push(`${s.teamAccess} client workspace access`);
  if (s.leads) parts.push(`${s.leads} lead${s.leads === 1 ? '' : 's'}`);
  if (s.deals) parts.push(`${s.deals} deal${s.deals === 1 ? '' : 's'}`);
  if (s.digestRecipients) parts.push('digest recipient list');
  if (notificationCount) {
    parts.push(
      `${notificationCount} inbox notification${notificationCount === 1 ? '' : 's'}`,
    );
  }
  if (!parts.length) return 'Nothing assigned to transfer.';
  return parts.join(' · ');
}

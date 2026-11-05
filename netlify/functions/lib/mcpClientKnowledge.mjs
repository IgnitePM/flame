/**
 * Sanitized, read-only client knowledge for the Perplexity MCP connector.
 * Never returns OAuth tokens, integration secrets, or raw Firestore dumps.
 */

import { getBillingPeriod } from '../../../src/utils/billingEngine.js';
import { getTaskComments } from '../../../src/utils/taskComments.js';
import { fetchCollection, fetchDoc, getDigestDb } from './firebaseDigestClient.mjs';
import {
  clip,
  MAX_NOTE_CHARS,
  retainerSummary,
  sanitizeClientSummary,
} from './mcpSanitize.mjs';

export { sanitizeClientSummary, stripSecretFields } from './mcpSanitize.mjs';

const MAX_SEARCH = 25;
const MAX_TODOS = 40;
const MAX_COMMENT_CHARS = 800;

function normalizeQuery(q) {
  return String(q || '')
    .trim()
    .toLowerCase();
}

export async function loadAllClients() {
  const db = await getDigestDb();
  const clients = await fetchCollection(db, 'clients');
  return (clients || []).filter((c) => c?.id && c?.name);
}

export async function searchClients(query, limit = 10) {
  const q = normalizeQuery(query);
  const lim = Math.min(MAX_SEARCH, Math.max(1, Number(limit) || 10));
  const clients = await loadAllClients();
  const scored = [];
  for (const c of clients) {
    if (c.archived) continue;
    const name = String(c.name || '').toLowerCase();
    const website = String(c.website || '').toLowerCase();
    const emails = (Array.isArray(c.clientEmails) ? c.clientEmails : [])
      .map((e) => String(e || '').toLowerCase())
      .join(' ');
    if (!q) {
      scored.push({ c, score: name });
      continue;
    }
    if (c.id === q || name === q) {
      scored.push({ c, score: `0_${name}` });
      continue;
    }
    if (name.includes(q) || website.includes(q) || emails.includes(q)) {
      scored.push({ c, score: `1_${name}` });
    }
  }
  scored.sort((a, b) => String(a.score).localeCompare(String(b.score)));
  return scored.slice(0, lim).map(({ c }) => sanitizeClientSummary(c));
}

export async function resolveClient({ clientId, name } = {}) {
  const id = String(clientId || '').trim();
  const nameQ = normalizeQuery(name);
  const clients = await loadAllClients();
  if (id) {
    const hit = clients.find((c) => c.id === id);
    if (hit) return hit;
  }
  if (nameQ) {
    const exact = clients.find(
      (c) => String(c.name || '').trim().toLowerCase() === nameQ,
    );
    if (exact) return exact;
    const partial = clients.filter((c) =>
      String(c.name || '').toLowerCase().includes(nameQ),
    );
    if (partial.length === 1) return partial[0];
    if (partial.length > 1) {
      const err = new Error(
        `Multiple clients match “${name}”. Pass clientId. Matches: ${partial
          .slice(0, 8)
          .map((c) => `${c.name} (${c.id})`)
          .join('; ')}`,
      );
      err.code = 'ambiguous_client';
      throw err;
    }
  }
  return null;
}

export async function getClientNotes(clientId) {
  const db = await getDigestDb();
  const notes = await fetchDoc(db, `clientNotes/${clientId}`);
  if (!notes) {
    return {
      clientId,
      generalNotes: '',
      cycleNotes: {},
    };
  }
  const cycleNotes = {};
  const rawCycles =
    notes.cycleNotes && typeof notes.cycleNotes === 'object' ? notes.cycleNotes : {};
  for (const [key, val] of Object.entries(rawCycles)) {
    cycleNotes[key] = clip(val, MAX_NOTE_CHARS);
  }
  return {
    clientId,
    generalNotes: clip(notes.generalNotes, MAX_NOTE_CHARS),
    cycleNotes,
  };
}

function collectOpenTodoRows(client, { limit = MAX_TODOS } = {}) {
  const lim = Math.min(MAX_TODOS, Math.max(1, Number(limit) || MAX_TODOS));
  const period = getBillingPeriod(client.billingDay || 1, 0);
  const cycles = client.todoCycles || {};
  const cycleKeys = [
    ...new Set([
      String(period.start),
      ...Object.keys(cycles).sort((a, b) => Number(b) - Number(a)),
    ]),
  ];

  const rows = [];
  for (const cycleKey of cycleKeys) {
    const cycleData = cycles[cycleKey] || {};
    for (const [categoryKey, cat] of Object.entries(cycleData)) {
      for (const item of cat?.items || []) {
        if (!item || item.done || item.requestStatus === 'rejected') continue;
        const comments = getTaskComments(item)
          .slice(-5)
          .map((c) => ({
            author: c.authorName || c.authorEmail || null,
            text: clip(c.text, MAX_COMMENT_CHARS),
            at: c.createdAt || null,
          }));
        rows.push({
          cycleStart: Number(cycleKey) || cycleKey,
          categoryKey,
          id: item.id,
          text: String(item.text || '').trim(),
          dueDate: item.dueDate || null,
          assignees: Array.isArray(item.assigneeEmails)
            ? item.assigneeEmails.filter(Boolean).slice(0, 10)
            : [],
          approvalStatus: item.approvalStatus || null,
          pinned: !!item.pinned,
          recurring: !!item.recurring,
          comments,
          isCurrentCycle: String(cycleKey) === String(period.start),
        });
      }
    }
  }

  rows.sort((a, b) => {
    if (a.isCurrentCycle !== b.isCurrentCycle) return a.isCurrentCycle ? -1 : 1;
    return Number(b.dueDate || 0) - Number(a.dueDate || 0);
  });
  return {
    billingPeriod: { start: period.start, end: period.end },
    todos: rows.slice(0, lim),
    truncated: rows.length > lim,
    totalOpenMatched: rows.length,
  };
}

export async function listOpenTodos(client, limit) {
  return collectOpenTodoRows(client, { limit });
}

export async function getRetainerUsage(client) {
  const period = getBillingPeriod(client.billingDay || 1, 0);
  const retainers = retainerSummary(client);
  let usedByCategory = {};
  try {
    const db = await getDigestDb();
    const logs = await fetchCollection(db, 'taskLogs', {
      where: [['clientId', '==', client.id]],
    }).catch(() => []);
    const pool =
      logs.length > 0
        ? logs
        : (await fetchCollection(db, 'taskLogs').catch(() => [])).filter((t) =>
            t.clientId
              ? t.clientId === client.id
              : String(t.clientName || '') === String(client.name || ''),
          );
    usedByCategory = {};
    for (const t of pool) {
      const start = Number(t.clockInTime || 0);
      if (start < period.start || start > period.end) continue;
      if (t.projectId) continue;
      const cat = String(t.projectName || '').trim();
      if (!cat) continue;
      const hours =
        Number(t.duration || 0) > 0
          ? Number(t.duration) / 3600000
          : Math.max(0, (Date.now() - start) / 3600000);
      usedByCategory[cat] = (usedByCategory[cat] || 0) + hours;
    }
  } catch {
    usedByCategory = {};
  }

  return {
    clientId: client.id,
    clientName: client.name,
    billingPeriod: { start: period.start, end: period.end },
    hourlyRate: Number(client.hourlyRate || 0) || null,
    lines: retainers.map((r) => {
      const used = Number(usedByCategory[r.category] || 0);
      return {
        category: r.category,
        allotted: r.allotted,
        used: Number(used.toFixed(2)),
        remaining: Number((r.allotted - used).toFixed(2)),
      };
    }),
  };
}

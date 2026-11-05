/**
 * Pure sanitizers for MCP responses (no Firebase imports).
 */

import { getEnabledRetainerCategoryNames } from '../../../src/utils/retainerCategories.js';

export const MAX_NOTE_CHARS = 12_000;

const SECRET_KEY_RE =
  /(token|secret|password|api[_-]?key|refresh|access[_-]?token|webhook[_-]?secret|credential)/i;

export function clip(text, max = MAX_NOTE_CHARS) {
  const s = String(text || '');
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

export function stripSecretFields(value, depth = 0) {
  if (value == null || depth > 8) return value;
  if (Array.isArray(value)) {
    return value.map((v) => stripSecretFields(v, depth + 1));
  }
  if (typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEY_RE.test(k)) continue;
    out[k] = stripSecretFields(v, depth + 1);
  }
  return out;
}

function contactSummary(c) {
  const primary =
    c?.primaryContact && typeof c.primaryContact === 'object'
      ? {
          name: String(c.primaryContact.name || '').trim() || null,
          email: String(c.primaryContact.email || '').trim().toLowerCase() || null,
          role: String(c.primaryContact.role || '').trim() || null,
        }
      : null;
  const emails = [
    ...new Set(
      (Array.isArray(c?.clientEmails) ? c.clientEmails : [])
        .map((e) => String(e || '').trim().toLowerCase())
        .filter((e) => e.includes('@')),
    ),
  ].slice(0, 20);
  return { primaryContact: primary, portalEmails: emails };
}

export function retainerSummary(client) {
  const names = getEnabledRetainerCategoryNames(client);
  return names.map((name) => ({
    category: name,
    allotted: Number(client?.retainers?.[name] ?? 0),
  }));
}

export function countOpenTodos(client) {
  let open = 0;
  const cycles = client?.todoCycles || {};
  for (const cycleData of Object.values(cycles)) {
    if (!cycleData || typeof cycleData !== 'object') continue;
    for (const cat of Object.values(cycleData)) {
      for (const item of cat?.items || []) {
        if (item && !item.done && item.requestStatus !== 'rejected') open += 1;
      }
    }
  }
  return open;
}

/** Public allowlisted client card (safe for tool responses). */
export function sanitizeClientSummary(client) {
  if (!client?.id) return null;
  const contacts = contactSummary(client);
  return {
    id: client.id,
    name: String(client.name || '').trim(),
    status: client.status || (client.archived ? 'archived' : 'active'),
    archived: !!client.archived,
    website: String(client.website || '').trim() || null,
    phone: String(client.phone || '').trim() || null,
    companyDescription: clip(client.companyDescription || '', 4000) || null,
    industry: String(client.industry || '').trim() || null,
    billingDay: Number(client.billingDay || 1),
    hourlyRate: Number(client.hourlyRate || 0) || null,
    perplexityUrl: String(client.perplexityUrl || '').trim() || null,
    driveFolderUrl: String(client.googleDriveFolderUrl || '').trim() || null,
    retainers: retainerSummary(client),
    openTodoCount: countOpenTodos(client),
    ...contacts,
  };
}

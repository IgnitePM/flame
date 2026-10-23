import { normalizeStaffEmail, staffHandle, staffDisplayName } from './staffDirectory.js';

export function getTaskComments(item) {
  return Array.isArray(item?.comments) ? item.comments.filter(Boolean) : [];
}

/**
 * Union two comment lists by comment id (stable order: existing first, then new).
 * Used when the same task id exists in prior + current billing cycles so portal
 * users still see notes that were left on the older cycle copy.
 */
export function mergeTaskCommentLists(existingComments, incomingComments) {
  const existing = Array.isArray(existingComments)
    ? existingComments.filter(Boolean)
    : [];
  const incoming = Array.isArray(incomingComments)
    ? incomingComments.filter(Boolean)
    : [];
  if (!incoming.length) return existing;
  if (!existing.length) return incoming;

  const seen = new Set();
  const out = [];
  for (const comment of [...existing, ...incoming]) {
    const id = String(comment?.id || '').trim();
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    out.push(comment);
  }
  return out;
}

/** True when `next` has any comment id not present in `prev`. */
export function taskCommentListsDiffer(prev, next) {
  const a = Array.isArray(prev) ? prev.filter(Boolean) : [];
  const b = Array.isArray(next) ? next.filter(Boolean) : [];
  if (a.length !== b.length) return true;
  const ids = new Set(
    a.map((c) => String(c?.id || '').trim()).filter(Boolean),
  );
  for (const comment of b) {
    const id = String(comment?.id || '').trim();
    if (id && !ids.has(id)) return true;
    if (!id) return true;
  }
  return false;
}

export function newCommentId() {
  return `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function claimUniqueHandle(preferred, used) {
  let base = String(preferred || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._+-]/g, '');
  if (!base) base = 'user';
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let i = 2;
  while (used.has(`${base}${i}`)) i += 1;
  const next = `${base}${i}`;
  used.add(next);
  return next;
}

/**
 * Staff + optional client portal contacts for @mention pickers / parsing.
 * Staff wins on email collision; handles stay unique across both lists.
 */
export function buildMentionDirectory({
  staffEmails = [],
  adminUsers = [],
  clientEmails = [],
  clientName = '',
} = {}) {
  const usedHandles = new Set();
  const byEmail = new Map();

  for (const row of adminUsers || []) {
    const email = normalizeStaffEmail(row?.email || row?.id);
    if (!email) continue;
    byEmail.set(email, {
      email,
      name: staffDisplayName(row),
      kind: 'staff',
    });
  }
  for (const email of staffEmails || []) {
    const key = normalizeStaffEmail(email);
    if (!key || byEmail.has(key)) continue;
    byEmail.set(key, {
      email: key,
      name: staffHandle(key),
      kind: 'staff',
    });
  }

  const staffRows = [...byEmail.values()].map((row) => ({
    ...row,
    handle: claimUniqueHandle(staffHandle(row.email), usedHandles),
  }));

  const clientLabel = String(clientName || 'Client').trim() || 'Client';
  const clientRows = [];
  for (const email of clientEmails || []) {
    const key = normalizeStaffEmail(email);
    if (!key || byEmail.has(key)) continue;
    const handle = claimUniqueHandle(staffHandle(key), usedHandles);
    clientRows.push({
      email: key,
      name: `${clientLabel} · ${staffHandle(key) || key}`,
      handle,
      kind: 'client',
    });
  }

  return [...staffRows, ...clientRows].sort((a, b) =>
    a.handle.localeCompare(b.handle),
  );
}

/**
 * Parse @mentions from comment text against a mention directory.
 */
export function parseMentionsFromDirectory(text, directory = []) {
  const raw = String(text || '');
  if (!raw.includes('@') || !directory.length) {
    return { staffEmails: [], clientEmails: [] };
  }
  const staff = new Set();
  const clients = new Set();
  const re = /@([a-z0-9._+-]+)/gi;
  let match;
  while ((match = re.exec(raw))) {
    const token = String(match[1] || '').toLowerCase();
    if (!token) continue;
    const hit =
      directory.find((row) => row.handle === token) ||
      directory.find((row) => row.email === token) ||
      directory.find(
        (row) => row.handle.startsWith(token) && token.length >= 3,
      );
    if (!hit?.email) continue;
    if (hit.kind === 'client') clients.add(hit.email);
    else staff.add(hit.email);
  }
  return { staffEmails: [...staff], clientEmails: [...clients] };
}

/**
 * Parse @mentions from comment text.
 * Matches @local-part against staff emails (chris, julius, etc.).
 * Prefer buildMentionDirectory + parseMentionsFromDirectory when clients
 * may also be tagged.
 */
export function parseMentionEmails(text, staffEmails = []) {
  const directory = buildMentionDirectory({ staffEmails });
  return parseMentionsFromDirectory(text, directory).staffEmails;
}

export function highlightMentions(text) {
  return String(text || '').replace(/@([a-z0-9._+-]+)/gi, (full) => full);
}

export function buildTaskComment({
  text,
  authorEmail,
  authorName,
  staffEmails = [],
  adminUsers = [],
  clientEmails = [],
  clientName = '',
  directory = null,
}) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  const author = normalizeStaffEmail(authorEmail);
  const dir =
    directory ||
    buildMentionDirectory({
      staffEmails,
      adminUsers,
      clientEmails,
      clientName,
    });
  const parsed = parseMentionsFromDirectory(trimmed, dir);
  const mentions = parsed.staffEmails.filter((email) => email !== author);
  const clientMentions = parsed.clientEmails.filter((email) => email !== author);
  return {
    id: newCommentId(),
    text: trimmed,
    authorEmail: author,
    authorName: String(authorName || staffHandle(author) || 'Staff').trim(),
    createdAt: Date.now(),
    mentions,
    clientMentions,
  };
}

export function appendTaskComment(item, comment) {
  if (!item || !comment) return item;
  return {
    ...item,
    comments: [...getTaskComments(item), comment],
  };
}

/**
 * Copy any comments present on `sourceItems` onto matching task ids in every
 * other billing-cycle bucket. Keeps portal Home (current cycle) in sync when
 * staff leave notes on a prior-cycle copy of the same task.
 *
 * @returns {{ cycles: object, changed: boolean }}
 */
export function syncTaskCommentsAcrossCycles(cycles, categoryKey, sourceItems) {
  const next = { ...(cycles || {}) };
  const sources = Array.isArray(sourceItems) ? sourceItems : [];
  const byId = new Map();
  for (const item of sources) {
    if (!item?.id) continue;
    const comments = getTaskComments(item);
    if (!comments.length) continue;
    byId.set(item.id, comments);
  }
  if (!byId.size || !categoryKey) return { cycles: next, changed: false };

  let changed = false;
  for (const [cycleKey, cycleData] of Object.entries(next)) {
    if (!cycleData || typeof cycleData !== 'object') continue;
    const cat = cycleData[categoryKey];
    if (!cat || !Array.isArray(cat.items)) continue;
    let catChanged = false;
    const items = cat.items.map((row) => {
      if (!row?.id || !byId.has(row.id)) return row;
      const merged = mergeTaskCommentLists(getTaskComments(row), byId.get(row.id));
      if (!taskCommentListsDiffer(getTaskComments(row), merged)) return row;
      catChanged = true;
      return { ...row, comments: merged };
    });
    if (!catChanged) continue;
    changed = true;
    next[cycleKey] = {
      ...cycleData,
      [categoryKey]: { ...cat, items },
    };
  }
  return { cycles: next, changed };
}

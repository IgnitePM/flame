import { normalizeStaffEmail, staffHandle, staffDisplayName } from './staffDirectory.js';

export function getTaskComments(item) {
  return Array.isArray(item?.comments) ? item.comments.filter(Boolean) : [];
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

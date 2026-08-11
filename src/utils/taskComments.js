import { normalizeStaffEmail, staffHandle } from './staffDirectory.js';

export function getTaskComments(item) {
  return Array.isArray(item?.comments) ? item.comments.filter(Boolean) : [];
}

export function newCommentId() {
  return `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Parse @mentions from comment text.
 * Matches @local-part against staff emails (chris, julius, etc.).
 */
export function parseMentionEmails(text, staffEmails = []) {
  const raw = String(text || '');
  if (!raw.includes('@')) return [];
  const directory = (staffEmails || [])
    .map((email) => ({
      email: normalizeStaffEmail(email),
      handle: staffHandle(email),
    }))
    .filter((row) => row.email && row.handle);

  const found = new Set();
  const re = /@([a-z0-9._+-]+)/gi;
  let match;
  while ((match = re.exec(raw))) {
    const token = String(match[1] || '').toLowerCase();
    if (!token) continue;
    const hit =
      directory.find((row) => row.handle === token) ||
      directory.find((row) => row.email === token) ||
      directory.find((row) => row.handle.startsWith(token) && token.length >= 3);
    if (hit) found.add(hit.email);
  }
  return [...found];
}

export function highlightMentions(text) {
  return String(text || '').replace(
    /@([a-z0-9._+-]+)/gi,
    (full) => full,
  );
}

export function buildTaskComment({
  text,
  authorEmail,
  authorName,
  staffEmails = [],
}) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  const author = normalizeStaffEmail(authorEmail);
  const mentions = parseMentionEmails(trimmed, staffEmails).filter(
    (email) => email !== author,
  );
  return {
    id: newCommentId(),
    text: trimmed,
    authorEmail: author,
    authorName: String(authorName || staffHandle(author) || 'Staff').trim(),
    createdAt: Date.now(),
    mentions,
  };
}

export function appendTaskComment(item, comment) {
  if (!item || !comment) return item;
  return {
    ...item,
    comments: [...getTaskComments(item), comment],
  };
}

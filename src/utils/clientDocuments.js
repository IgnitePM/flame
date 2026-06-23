import { doc, getDoc, setDoc } from '../firebase.js';

export const MAX_CLIENT_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_TODO_ATTACHMENTS = 10;

export function newDocumentId() {
  return `doc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function newContactId() {
  return `contact_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function emptyPrimaryContact() {
  return { name: '', email: '', phone: '', title: '' };
}

export function normalizePrimaryContact(raw) {
  if (!raw || typeof raw !== 'object') return emptyPrimaryContact();
  return {
    name: String(raw.name || '').trim(),
    email: String(raw.email || '').trim(),
    phone: String(raw.phone || '').trim(),
    title: String(raw.title || '').trim(),
  };
}

export function normalizeClientContact(raw) {
  return {
    id: raw?.id || newContactId(),
    name: String(raw?.name || '').trim(),
    email: String(raw?.email || '').trim(),
    phone: String(raw?.phone || '').trim(),
    title: String(raw?.title || '').trim(),
    notes: String(raw?.notes || '').trim(),
  };
}

export function normalizeClientContacts(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeClientContact).filter((c) => c.name || c.email || c.phone);
}

export function sanitizeFileName(name) {
  return String(name || 'file')
    .replace(/[^\w.\-()+ ]/g, '_')
    .slice(0, 120);
}

export function buildClientFileStoragePath(clientId, documentId, fileName) {
  return `client-files/${clientId}/${documentId}_${sanitizeFileName(fileName)}`;
}

export function formatFileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function buildClientDocumentRecord({
  id,
  name,
  storagePath,
  contentType,
  sizeBytes,
  uploadedBy,
  url,
  linkedTodoId = null,
  linkedTodoText = null,
  linkedCategoryKey = null,
  linkedCycleStart = null,
}) {
  return {
    id: id || newDocumentId(),
    name: String(name || '').trim() || 'file',
    storagePath,
    contentType: contentType || 'application/octet-stream',
    sizeBytes: Number(sizeBytes) || 0,
    uploadedAt: Date.now(),
    uploadedBy: String(uploadedBy || '').trim().toLowerCase(),
    url: url || null,
    linkedTodoId: linkedTodoId || null,
    linkedTodoText: linkedTodoText || null,
    linkedCategoryKey: linkedCategoryKey || null,
    linkedCycleStart:
      linkedCycleStart != null && linkedCycleStart !== ''
        ? Number(linkedCycleStart)
        : null,
  };
}

export function getTodoAttachments(item) {
  return Array.isArray(item?.attachments) ? item.attachments : [];
}

export function addAttachmentToItem(item, record) {
  const attachments = getTodoAttachments(item);
  return { ...item, attachments: [...attachments, record] };
}

export function removeAttachmentFromItem(item, documentId) {
  return {
    ...item,
    attachments: getTodoAttachments(item).filter((a) => a?.id !== documentId),
  };
}

export function removeDocumentFromTodoCycles(todoCycles, documentId) {
  if (!todoCycles || typeof todoCycles !== 'object') return todoCycles;
  const next = {};
  for (const [cycleKey, cycleData] of Object.entries(todoCycles)) {
    if (!cycleData || typeof cycleData !== 'object') {
      next[cycleKey] = cycleData;
      continue;
    }
    const cyclePatch = {};
    for (const [catKey, catTodo] of Object.entries(cycleData)) {
      if (!catTodo || !Array.isArray(catTodo.items)) {
        cyclePatch[catKey] = catTodo;
        continue;
      }
      cyclePatch[catKey] = {
        ...catTodo,
        items: catTodo.items.map((item) => removeAttachmentFromItem(item, documentId)),
      };
    }
    next[cycleKey] = cyclePatch;
  }
  return next;
}

export function validateClientUploadFile(file) {
  if (!file) return 'No file selected.';
  if (file.size > MAX_CLIENT_FILE_BYTES) {
    return `File is too large (max ${formatFileSize(MAX_CLIENT_FILE_BYTES)}).`;
  }
  return null;
}

/**
 * Storage rules require admins/{emailLower}. Ensure the doc exists before upload
 * so kiosk staff and new @ignitepm.com sign-ins are not blocked by a race.
 */
export async function ensureStaffAdminDocForStorage(db, userEmail) {
  const emailKey = String(userEmail || '').trim().toLowerCase();
  if (!emailKey) {
    throw new Error('You must be signed in to upload files.');
  }
  const adminRef = doc(db, 'admins', emailKey);
  const snap = await getDoc(adminRef);
  if (snap.exists()) return;

  if (emailKey.endsWith('@ignitepm.com')) {
    await setDoc(adminRef, { email: emailKey, role: 'kiosk' }, { merge: true });
    return;
  }

  throw new Error(
    'Your account is not registered as staff (missing admins profile). Ask an admin to grant access under Users, then sign out and back in.',
  );
}

export function normalizeExternalUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

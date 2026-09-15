import { db, doc, getDoc, setDoc } from '../firebase.js';
import { portalToolSaveDocId } from './registry.js';

/**
 * Load a portal mini-app save for a client.
 * Returns { data, title, updatedAt, updatedByEmail } or null.
 */
export async function loadPortalToolSave(clientId, toolId, saveKey = 'default') {
  const id = portalToolSaveDocId(clientId, toolId, saveKey);
  const snap = await getDoc(doc(db, 'clientPortalToolSaves', id));
  if (!snap.exists()) return null;
  const row = snap.data() || {};
  return {
    id: snap.id,
    data: row.data ?? null,
    title: row.title || '',
    updatedAt: Number(row.updatedAt || 0) || null,
    updatedByEmail: row.updatedByEmail || '',
  };
}

/**
 * Persist mini-app state for a client. `data` should be JSON-serializable.
 */
export async function savePortalToolSave({
  clientId,
  clientName = '',
  toolId,
  data,
  saveKey = 'default',
  title = '',
  updatedByEmail = '',
} = {}) {
  const id = portalToolSaveDocId(clientId, toolId, saveKey);
  const now = Date.now();
  const prev = await getDoc(doc(db, 'clientPortalToolSaves', id));
  const createdAt = prev.exists()
    ? Number(prev.data()?.createdAt || now)
    : now;

  await setDoc(
    doc(db, 'clientPortalToolSaves', id),
    {
      clientId,
      clientName: String(clientName || ''),
      toolId,
      saveKey: String(saveKey || 'default'),
      title: String(title || '').trim(),
      data: data ?? null,
      updatedAt: now,
      updatedByEmail: String(updatedByEmail || '').trim().toLowerCase(),
      createdAt,
    },
    { merge: true },
  );

  return { id, updatedAt: now };
}

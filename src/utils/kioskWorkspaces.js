/**
 * Multi-client workspace tabs for the employee kiosk.
 * Each tab pins a client + billing target so you can jump between them
 * while an AI prompt (or other wait) runs on another account.
 */

export const MAX_KIOSK_WORKSPACES = 8;

export function workspaceStorageKey(userKey = '') {
  const key = String(userKey || 'anon')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9@._+-]+/g, '_');
  return `flame.kioskWorkspaces.v1:${key || 'anon'}`;
}

export function newWorkspaceId() {
  return `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createWorkspace({
  clientName = '',
  billingTarget = '',
  id = null,
} = {}) {
  return {
    id: id || newWorkspaceId(),
    clientName: String(clientName || ''),
    billingTarget: String(billingTarget || ''),
  };
}

export function workspaceLabel(ws, { generalLabel = 'General' } = {}) {
  const client = String(ws?.clientName || '').trim() || 'New';
  const target = String(ws?.billingTarget || '');
  let cat = '';
  if (target.startsWith('retainer_')) {
    const raw = target.slice('retainer_'.length);
    cat = raw === 'GENERAL_UNCLASSIFIED' ? generalLabel : raw;
  } else if (target.startsWith('project_')) {
    cat = 'Project';
  }
  return cat ? `${client} · ${cat}` : client;
}

export function shortWorkspaceLabel(ws, { generalLabel = 'General' } = {}) {
  const full = workspaceLabel(ws, { generalLabel });
  if (full.length <= 28) return full;
  return `${full.slice(0, 26)}…`;
}

export function findWorkspaceIndex(workspaces, { clientName, billingTarget }) {
  const c = String(clientName || '');
  const t = String(billingTarget || '');
  return (workspaces || []).findIndex(
    (ws) => ws.clientName === c && ws.billingTarget === t,
  );
}

/**
 * Upsert a workspace for this client+target and move it to the front of
 * "active" attention (keep order otherwise). Caps at MAX_KIOSK_WORKSPACES.
 */
export function upsertWorkspace(workspaces, { clientName, billingTarget }) {
  const next = [...(workspaces || [])];
  const idx = findWorkspaceIndex(next, { clientName, billingTarget });
  let activeId;
  if (idx >= 0) {
    activeId = next[idx].id;
  } else {
    const ws = createWorkspace({ clientName, billingTarget });
    next.push(ws);
    activeId = ws.id;
    while (next.length > MAX_KIOSK_WORKSPACES) {
      // Drop oldest empty tabs first, else oldest non-active.
      const emptyIdx = next.findIndex(
        (w) => w.id !== activeId && !w.clientName && !w.billingTarget,
      );
      if (emptyIdx >= 0) next.splice(emptyIdx, 1);
      else {
        const dropIdx = next.findIndex((w) => w.id !== activeId);
        if (dropIdx < 0) break;
        next.splice(dropIdx, 1);
      }
    }
  }
  return { workspaces: next, activeId };
}

export function removeWorkspace(workspaces, id) {
  const list = (workspaces || []).filter((w) => w.id !== id);
  return list.length ? list : [createWorkspace()];
}

export function updateWorkspace(workspaces, id, patch) {
  return (workspaces || []).map((w) =>
    w.id === id ? { ...w, ...patch, id: w.id } : w,
  );
}

export function billingTargetMatchesActiveTask(activeTask, billingTarget) {
  if (!activeTask || !billingTarget) return false;
  const target = String(billingTarget);
  if (target.startsWith('project_')) {
    return activeTask.projectId === target.slice('project_'.length);
  }
  if (target === 'retainer_GENERAL_UNCLASSIFIED') {
    return !activeTask.projectId && activeTask.projectName === 'General / Unclassified';
  }
  if (target.startsWith('retainer_')) {
    const name = target.slice('retainer_'.length);
    return !activeTask.projectId && activeTask.projectName === name;
  }
  return false;
}

export function isTimingWorkspace(activeTask, ws, { generalLabel = 'General / Unclassified' } = {}) {
  if (!activeTask || !ws?.clientName) return false;
  if (activeTask.clientName !== ws.clientName) return false;
  if (!ws.billingTarget) {
    // Tab only pinned the client — still count as timing that client.
    return true;
  }
  if (ws.billingTarget.startsWith('project_')) {
    return activeTask.projectId === ws.billingTarget.slice('project_'.length);
  }
  if (ws.billingTarget === 'retainer_GENERAL_UNCLASSIFIED') {
    return (
      !activeTask.projectId &&
      (activeTask.projectName === generalLabel ||
        activeTask.projectName === 'General / Unclassified')
    );
  }
  if (ws.billingTarget.startsWith('retainer_')) {
    return (
      !activeTask.projectId &&
      activeTask.projectName === ws.billingTarget.slice('retainer_'.length)
    );
  }
  return false;
}

export function loadWorkspacesFromStorage(storage, userKey) {
  try {
    const raw = storage?.getItem?.(workspaceStorageKey(userKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const list = Array.isArray(parsed.workspaces)
      ? parsed.workspaces
          .filter((w) => w && typeof w === 'object')
          .map((w) =>
            createWorkspace({
              id: w.id,
              clientName: w.clientName,
              billingTarget: w.billingTarget,
            }),
          )
      : [];
    if (!list.length) return null;
    const activeId =
      list.some((w) => w.id === parsed.activeId) ? parsed.activeId : list[0].id;
    return { workspaces: list, activeId };
  } catch {
    return null;
  }
}

export function saveWorkspacesToStorage(storage, userKey, { workspaces, activeId }) {
  try {
    storage?.setItem?.(
      workspaceStorageKey(userKey),
      JSON.stringify({
        workspaces: (workspaces || []).map((w) => ({
          id: w.id,
          clientName: w.clientName || '',
          billingTarget: w.billingTarget || '',
        })),
        activeId: activeId || null,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

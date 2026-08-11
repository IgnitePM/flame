const DEAL_DRAG_MIME = 'application/x-ignite-deal';

/** @type {{ dealId: string } | null} */
let activeDealDragPayload = null;

export function setActiveDealDragPayload(payload) {
  activeDealDragPayload = payload || null;
}

export function clearActiveDealDragPayload() {
  activeDealDragPayload = null;
}

export function peekDealDragPayload() {
  return activeDealDragPayload;
}

export function hasDealDragPayload(dataTransfer) {
  if (activeDealDragPayload) return true;
  if (!dataTransfer?.types) return false;
  const types = Array.from(dataTransfer.types);
  return types.includes(DEAL_DRAG_MIME) || types.includes('text/plain');
}

export function writeDealDragPayload(dataTransfer, dealId) {
  const payload = { dealId: String(dealId) };
  setActiveDealDragPayload(payload);
  const raw = JSON.stringify(payload);
  try {
    dataTransfer.setData(DEAL_DRAG_MIME, raw);
  } catch {
    // some browsers
  }
  try {
    dataTransfer.setData('text/plain', raw);
  } catch {
    // ignore
  }
  dataTransfer.effectAllowed = 'move';
}

export function readDealDragPayload(dataTransfer) {
  const peeked = peekDealDragPayload();
  if (peeked?.dealId) return peeked;
  let raw = '';
  try {
    raw =
      dataTransfer?.getData(DEAL_DRAG_MIME) ||
      dataTransfer?.getData('text/plain') ||
      '';
  } catch {
    raw = '';
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.dealId) return { dealId: String(parsed.dealId) };
  } catch {
    if (typeof raw === 'string' && raw.trim()) {
      return { dealId: raw.trim() };
    }
  }
  return null;
}

export { DEAL_DRAG_MIME };

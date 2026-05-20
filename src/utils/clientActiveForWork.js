/**
 * Clients that are archived or paused should not surface in operational UIs
 * (kiosk selection, global to-dos, pending retainer insights, new task logging).
 */
export function isClientActiveForWork(c) {
  return !!(c && !c.archived && c.status !== 'paused');
}

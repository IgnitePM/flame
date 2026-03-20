/**
 * To-do list ordering for client cycle tasks (Firestore `todoCycles`).
 * Pinned items sort to the top; order within pinned / unpinned groups is stable.
 */

export function orderTodosForDisplay(items) {
  const arr = [...(items || [])];
  return arr.sort((a, b) => {
    const ap = a?.pinned ? 1 : 0;
    const bp = b?.pinned ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return 0;
  });
}

/**
 * Reorder after drag-and-drop on the *display* list (pinned-first view).
 */
export function reorderTodosDisplay(items, fromDisplayIndex, toDisplayIndex) {
  const display = orderTodosForDisplay(items || []);
  if (
    fromDisplayIndex < 0 ||
    fromDisplayIndex >= display.length ||
    toDisplayIndex < 0 ||
    toDisplayIndex > display.length
  ) {
    return items || [];
  }
  const moved = display[fromDisplayIndex];
  const rest = display.filter((_, i) => i !== fromDisplayIndex);
  const safeTo = Math.min(Math.max(0, toDisplayIndex), rest.length);
  rest.splice(safeTo, 0, moved);
  return rest;
}

/** Toggle `pinned` on one item and move pinned group to the top (stable). */
export function toggleTodoPinnedById(items, id) {
  const raw = (items || []).map((it) =>
    it.id === id ? { ...it, pinned: !it.pinned } : it,
  );
  return orderTodosForDisplay(raw);
}

/**
 * Detect mirrored Messages rows that belong to a task Notes thread.
 */
export function taskReplyContextFromMessage(m) {
  if (!m) return null;
  const kind = String(m.systemKind || '');
  if (kind !== 'todo_note_mention' && kind !== 'portal_todo_note') return null;
  const itemId = String(m.itemId || '').trim();
  const categoryKey = String(m.categoryKey || '').trim();
  if (!itemId || !categoryKey) return null;
  return {
    itemId,
    categoryKey,
    cycleStart:
      m.cycleStart != null && m.cycleStart !== ''
        ? Number(m.cycleStart)
        : null,
    taskTitle: String(m.taskTitle || '').trim() || 'Task',
    messageId: m.id,
  };
}

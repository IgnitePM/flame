/** Max emails linked to a single primary todo. */
export const MAX_TODO_EMAIL_ATTACHMENTS = 10;

export function getTodoEmailAttachments(item) {
  return Array.isArray(item?.emailAttachments) ? item.emailAttachments : [];
}

export function newEmailAttachmentId() {
  return `emailatt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Build a denormalized email attachment snapshot from a clientEmailMessages doc.
 * Stores messageId + gmailThreadId so the UI can show the message and later browse the thread.
 */
export function buildEmailAttachmentRecord(message, overrides = {}) {
  if (!message?.id) return null;
  const inbound = message.direction === 'inbound';
  const from = inbound
    ? String(message.from || message.actorEmail || '').trim()
    : String(message.actorEmail || message.from || '').trim();
  return {
    id: newEmailAttachmentId(),
    messageId: String(message.id),
    gmailThreadId: message.gmailThreadId
      ? String(message.gmailThreadId)
      : null,
    subject: String(message.subject || '').trim() || '(no subject)',
    from,
    direction: inbound ? 'inbound' : 'outbound',
    sentAt: Number(message.sentAt || 0) || null,
    attachedAt: Date.now(),
    ...overrides,
  };
}

export function addEmailAttachmentToItem(item, record) {
  if (!record?.messageId) return item;
  const existing = getTodoEmailAttachments(item);
  if (existing.some((a) => a?.messageId === record.messageId)) {
    return item;
  }
  if (existing.length >= MAX_TODO_EMAIL_ATTACHMENTS) {
    throw new Error(
      `Maximum ${MAX_TODO_EMAIL_ATTACHMENTS} emails per task.`,
    );
  }
  return {
    ...item,
    emailAttachments: [...existing, record],
  };
}

export function removeEmailAttachmentFromItem(item, attachmentId) {
  return {
    ...item,
    emailAttachments: getTodoEmailAttachments(item).filter(
      (a) => a?.id !== attachmentId,
    ),
  };
}

/** True when this message is already linked on the todo. */
export function todoHasEmailMessage(item, messageId) {
  const id = String(messageId || '').trim();
  if (!id) return false;
  return getTodoEmailAttachments(item).some((a) => a?.messageId === id);
}

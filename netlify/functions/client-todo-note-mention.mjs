import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import {
  createMessageDoc,
  loadClient,
  notifyPortalTodoNoteMention,
  writeClientActivity,
} from './lib/clientMessaging.mjs';

/**
 * Staff tagged one or more client portal contacts in a task note.
 * POST {
 *   clientId, itemId?, categoryKey?, cycleStart?,
 *   taskTitle, commentText, commentId?,
 *   mentionedEmails: string[]
 * }
 */
export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let caller;
  try {
    caller = await requireStaffCaller(req.headers);
  } catch (err) {
    const { status, message } = describeAuthError(err);
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const clientId = String(body.clientId || '').trim();
  const taskTitle = String(body.taskTitle || 'Task').trim() || 'Task';
  const commentText = String(body.commentText || '').trim();
  const mentionedEmails = Array.isArray(body.mentionedEmails)
    ? body.mentionedEmails
    : [];

  if (!clientId) {
    return new Response(JSON.stringify({ error: 'clientId is required.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!mentionedEmails.length) {
    return new Response(
      JSON.stringify({ error: 'mentionedEmails is required.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  if (!commentText) {
    return new Response(JSON.stringify({ error: 'commentText is required.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const client = await loadClient(clientId);
    const authorName = caller.email || 'Ignite';

    let emailResult = { sent: 0 };
    try {
      emailResult = await notifyPortalTodoNoteMention({
        client,
        taskTitle,
        commentText,
        authorName,
        mentionedEmails,
      });
    } catch (err) {
      console.warn('[client-todo-note-mention] email:', err?.message || err);
      emailResult = { sent: 0, error: err?.message || String(err) };
    }

    try {
      await createMessageDoc({
        clientId,
        body: `${authorName} tagged you on task “${taskTitle}”:\n\n${commentText}`,
        authorType: 'staff',
        authorEmail: caller.email,
        authorName,
        attachments: [],
        createdAt: Date.now(),
        systemKind: 'todo_note_mention',
      });
    } catch (err) {
      console.warn('[client-todo-note-mention] message:', err?.message || err);
    }

    try {
      await writeClientActivity({
        clientId,
        clientName: client.name || '',
        type: 'todo_note_mention',
        title: `Tagged client on task: ${taskTitle}`,
        body: commentText.slice(0, 500),
        actorEmail: caller.email,
        source: 'system',
        meta: {
          itemId: body.itemId || null,
          categoryKey: body.categoryKey || null,
          cycleStart: body.cycleStart || null,
          commentId: body.commentId || null,
          mentionedEmails,
        },
      });
    } catch (err) {
      console.warn('[client-todo-note-mention] activity:', err?.message || err);
    }

    return new Response(
      JSON.stringify({ ok: true, email: emailResult }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[client-todo-note-mention]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not notify client.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

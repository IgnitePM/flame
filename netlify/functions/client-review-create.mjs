import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import {
  createMessageDoc,
  createReviewDoc,
  loadClient,
  normalizeAttachments,
  notifyPortalReviewSent,
  writeClientActivity,
} from './lib/clientMessaging.mjs';

/**
 * Staff: create a deliverable review request + email portal contacts.
 * POST { clientId, title, description?, attachments? }
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
  const title = String(body.title || '').trim();
  const description = String(body.description || '').trim();
  if (!clientId || !title) {
    return new Response(JSON.stringify({ error: 'clientId and title are required.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const client = await loadClient(clientId);
    const attachments = normalizeAttachments(body.attachments);
    const now = Date.now();

    const systemNote = await createMessageDoc({
      clientId,
      body: `Approval requested: ${title}${description ? `\n\n${description}` : ''}`,
      authorType: 'staff',
      authorEmail: caller.email,
      authorName: caller.email,
      attachments,
      createdAt: now,
      systemKind: 'review_sent',
    });

    const review = await createReviewDoc({
      clientId,
      title,
      description,
      status: 'pending',
      attachments,
      createdByEmail: caller.email,
      createdAt: now,
      linkedMessageId: systemNote.id,
    });

    let emailResult = { sent: 0 };
    try {
      emailResult = await notifyPortalReviewSent({ client, title, description });
    } catch (err) {
      console.warn('[client-review-create] email failed:', err?.message || err);
      emailResult = { sent: 0, error: err?.message || String(err) };
    }

    try {
      await writeClientActivity({
        clientId,
        clientName: client.name || '',
        type: 'review_sent',
        title: `Approval sent: ${title}`,
        body: description.slice(0, 500),
        actorEmail: caller.email,
        source: 'system',
        meta: { reviewId: review.id },
      });
    } catch (err) {
      console.warn('[client-review-create] activity failed:', err?.message || err);
    }

    return new Response(
      JSON.stringify({ ok: true, review, message: systemNote, email: emailResult }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[client-review-create]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not create review.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

import {
  describeAuthError,
  requireClientOrStaffCaller,
} from './lib/requireAuth.mjs';
import {
  createMessageDoc,
  fetchDoc,
  getDigestDb,
  loadClient,
  notifyStaffReviewDecision,
  updateReviewDoc,
  writeClientActivity,
} from './lib/clientMessaging.mjs';

/**
 * Portal (or staff): decide a pending review.
 * POST { clientId, reviewId, status: 'approved'|'revisions_requested', decisionNote? }
 */
export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
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
  const reviewId = String(body.reviewId || '').trim();
  const status = String(body.status || '').trim();
  const decisionNote = String(body.decisionNote || '').trim();

  if (!['approved', 'revisions_requested'].includes(status)) {
    return new Response(
      JSON.stringify({ error: 'status must be approved or revisions_requested.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let caller;
  try {
    caller = await requireClientOrStaffCaller(req.headers, clientId);
  } catch (err) {
    const { status: st, message } = describeAuthError(err);
    return new Response(JSON.stringify({ error: message }), {
      status: st,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const db = await getDigestDb();
    const review = await fetchDoc(db, `clientReviews/${reviewId}`);
    if (!review || review.clientId !== clientId) {
      return new Response(JSON.stringify({ error: 'Review not found.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (review.status !== 'pending') {
      return new Response(JSON.stringify({ error: 'This review is already decided.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const client = await loadClient(clientId);
    const now = Date.now();
    const label = status === 'approved' ? 'Approved' : 'Revisions requested';

    const systemNote = await createMessageDoc({
      clientId,
      body: `${label}: ${review.title}${decisionNote ? `\n\n${decisionNote}` : ''}`,
      authorType: caller.authorType,
      authorEmail: caller.email,
      authorName: caller.email,
      attachments: [],
      createdAt: now,
      systemKind: 'review_decision',
    });

    await updateReviewDoc(reviewId, {
      status,
      decisionAt: now,
      decisionByEmail: caller.email,
      decisionNote,
      linkedMessageId: systemNote.id,
    });

    let emailResult = { sent: 0 };
    try {
      emailResult = await notifyStaffReviewDecision({
        client,
        title: review.title,
        status,
        note: decisionNote,
        byEmail: caller.email,
      });
    } catch (err) {
      console.warn('[client-review-decide] email failed:', err?.message || err);
      emailResult = { sent: 0, error: err?.message || String(err) };
    }

    try {
      await writeClientActivity({
        clientId,
        clientName: client.name || '',
        type: 'review_decision',
        title: `${label}: ${review.title}`,
        body: decisionNote.slice(0, 500),
        actorEmail: caller.email,
        source: 'system',
        meta: { reviewId, status },
      });
    } catch (err) {
      console.warn('[client-review-decide] activity failed:', err?.message || err);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        review: {
          ...review,
          status,
          decisionAt: now,
          decisionByEmail: caller.email,
          decisionNote,
          linkedMessageId: systemNote.id,
        },
        message: systemNote,
        email: emailResult,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[client-review-decide]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not save decision.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

import {
  describeAuthError,
  requireClientOrStaffCaller,
} from './lib/requireAuth.mjs';
import {
  collectClientStaffNotifyEmails,
  createFeedbackDoc,
  loadClient,
  notifyStaffPortalFeedback,
  writeClientActivity,
  writeStaffInboxNotifications,
} from './lib/clientMessaging.mjs';

/**
 * Portal or staff: submit product feedback / bug report.
 * POST {
 *   clientId, type?: 'feedback'|'bug', subject?, body,
 *   portalSection?, pageUrl?, userAgent?, createdByName?
 * }
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
  const text = String(body.body || '').trim();
  const type = String(body.type || '').trim() === 'bug' ? 'bug' : 'feedback';
  const subject = String(body.subject || '').trim().slice(0, 120);
  const portalSection = String(body.portalSection || '').trim().slice(0, 40);
  const pageUrl = String(body.pageUrl || '').trim().slice(0, 500);
  const userAgent = String(body.userAgent || '').trim().slice(0, 400);

  if (!clientId) {
    return new Response(JSON.stringify({ error: 'clientId is required.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (text.length < 10) {
    return new Response(
      JSON.stringify({ error: 'Please include more detail in your message.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let caller;
  try {
    caller = await requireClientOrStaffCaller(req.headers, clientId);
  } catch (err) {
    const { status, message } = describeAuthError(err);
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const client = await loadClient(clientId);
    const now = Date.now();
    const feedback = await createFeedbackDoc({
      clientId,
      clientName: client.name || '',
      type,
      subject,
      body: text.slice(0, 5000),
      portalSection: portalSection || null,
      pageUrl: pageUrl || null,
      userAgent: userAgent || null,
      status: 'new',
      createdByEmail: caller.email,
      createdByName:
        String(body.createdByName || '').trim().slice(0, 80) || caller.email,
      createdAt: now,
      updatedAt: now,
    });

    const kindLabel = type === 'bug' ? 'Bug report' : 'Feedback';
    const title = subject || `${kindLabel} from portal`;

    let emailResult = { sent: 0 };
    const notifyEmails = collectClientStaffNotifyEmails(client);
    try {
      emailResult = await notifyStaffPortalFeedback({
        client,
        type,
        subject: title,
        body: text,
        byEmail: caller.email,
        notifyEmails,
      });
      if (emailResult.sent > 0) {
        // stamped on create path via merge if needed — optional
      }
    } catch (err) {
      console.warn('[client-feedback-submit] email:', err?.message || err);
      emailResult = { sent: 0, error: err?.message || String(err) };
    }

    try {
      await writeStaffInboxNotifications({
        recipientEmails: notifyEmails,
        type: 'portal_feedback',
        title: `${kindLabel}: ${title}`,
        body: `${caller.email} · ${client.name || 'Client'}: ${text.slice(0, 280)}`,
        actorEmail: caller.email,
        actorName: feedback.createdByName || caller.email,
        clientId,
        clientName: client.name || '',
        itemId: feedback.id,
        idPrefix: 'portal_fb',
      });
    } catch (err) {
      console.warn('[client-feedback-submit] inbox:', err?.message || err);
    }

    try {
      await writeClientActivity({
        clientId,
        clientName: client.name || '',
        type: 'portal_feedback',
        title: `${kindLabel}: ${title}`,
        body: text.slice(0, 500),
        actorEmail: caller.email,
        source: 'system',
        meta: {
          feedbackId: feedback.id,
          feedbackType: type,
          portalSection: portalSection || null,
        },
      });
    } catch (err) {
      console.warn('[client-feedback-submit] activity:', err?.message || err);
    }

    return new Response(
      JSON.stringify({ ok: true, feedback, email: emailResult }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[client-feedback-submit]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not submit feedback.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

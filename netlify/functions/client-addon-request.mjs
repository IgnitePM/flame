import {
  describeAuthError,
  requireClientOrStaffCaller,
} from './lib/requireAuth.mjs';
import {
  fetchCollection,
  fetchDoc,
  getDigestDb,
  mergeDoc,
} from './lib/firebaseDigestClient.mjs';
import { writeClientActivity } from './lib/clientActivity.mjs';
import { sendDigestEmail } from './lib/mailer.mjs';
import { appBaseUrl } from './lib/clientMessaging.mjs';
import { notifyClientSlack } from './lib/clientSlack.mjs';
import { getBillingPeriod } from '../../src/utils/billingEngine.js';

function resolveInvoiceRecipients(settings, adminUsers = []) {
  const configured = Array.isArray(settings.emailDigestRecipients)
    ? settings.emailDigestRecipients
    : [];
  const fromEnv = String(process.env.DIGEST_RECIPIENTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const fromList = [...configured, ...fromEnv]
    .map((e) => String(e || '').trim().toLowerCase())
    .filter((e) => e.includes('@'));

  if (fromList.length) return [...new Set(fromList)];

  const bot = String(process.env.DIGEST_BOT_EMAIL || '')
    .trim()
    .toLowerCase();
  // Prefer admin + billing roles when no explicit digest list is set.
  const staff = (adminUsers || [])
    .map((a) => ({
      email: String(a.email || a.id || '').trim().toLowerCase(),
      role: String(a.role || '').trim().toLowerCase(),
    }))
    .filter((a) => a.email && a.email !== bot && a.email.includes('@'));
  const billingFirst = staff.filter((a) => a.role === 'admin' || a.role === 'billing');
  const pick = billingFirst.length ? billingFirst : staff;
  return [...new Set(pick.map((a) => a.email))];
}

/**
 * Create an add-on hours request and notify staff (email + Slack) when a
 * client purchases hours so someone can invoice them.
 *
 * POST {
 *   clientId, hours, notes?, category?, cycleTarget?: 'current'|'next',
 *   requestedBy?: 'client'|'admin'
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
  const hoursNum = Math.max(0, Number(body.hours) || 0);
  if (!clientId) {
    return new Response(JSON.stringify({ error: 'Missing client.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!hoursNum) {
    return new Response(JSON.stringify({ error: 'Enter hours to add.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
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
    const db = await getDigestDb();
    const client = await fetchDoc(db, `clients/${clientId}`);
    if (!client) {
      return new Response(JSON.stringify({ error: 'Client not found.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const requestedBy =
      String(body.requestedBy || '').toLowerCase() === 'admin' && caller.isStaff
        ? 'admin'
        : caller.authorType === 'client' || !caller.isStaff
          ? 'client'
          : String(body.requestedBy || 'admin').toLowerCase() === 'client'
            ? 'client'
            : 'admin';

    // Portal callers are always treated as client purchases.
    const isClientPurchase =
      caller.authorType === 'client' || requestedBy === 'client';

    const hourlyRate = Number(client.hourlyRate) || 0;
    const subtotal = hoursNum * hourlyRate;
    const hstRate = 0.13;
    const hst = subtotal * hstRate;
    const total = subtotal + hst;

    const cycleOffset =
      String(body.cycleTarget || 'current').toLowerCase() === 'next' ? 1 : 0;
    const billingCycleStart = getBillingPeriod(
      client.billingDay || 1,
      cycleOffset,
    ).start;

    const category =
      String(body.category || '').trim() || 'Additional Hours';
    const notes = String(body.notes || '').trim();

    const addonId = `addon_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const addon = {
      clientId,
      clientName: client.name || '',
      hours: hoursNum,
      notes,
      category,
      requestedBy: isClientPurchase ? 'client' : 'admin',
      billingCycleStart,
      priceBreakdown: { hourlyRate, subtotal, hstRate, hst, total },
      notificationState: {
        adminNeedsInvoice: isClientPurchase,
        clientVisible: true,
      },
      status: 'pending',
      date: Date.now(),
      createdByEmail: caller.email || '',
    };

    await mergeDoc(db, `addons/${addonId}`, addon);

    const settings = (await fetchDoc(db, 'settings/notifications')) || {};
    const billingHref = `${appBaseUrl()}/?tab=billing`;

    if (isClientPurchase) {
      const slackEnabled = settings.notifyAddonPurchases !== false;
      if (slackEnabled) {
        try {
          await notifyClientSlack({
            clientId,
            alsoGlobal: true,
            text:
              `:moneybag: *Add-on hours requested* — *${client.name || 'Client'}* wants *${hoursNum.toFixed(1)}h*` +
              (total
                ? ` (≈ $${total.toFixed(2)} incl. HST)`
                : '') +
              `\nCycle: ${cycleOffset === 1 ? 'next' : 'current'} · Invoice in Billing.` +
              (notes ? `\n> ${notes.slice(0, 280)}` : ''),
          });
        } catch (err) {
          console.warn('[client-addon-request] slack:', err?.message || err);
        }
      }

      try {
        const admins = await fetchCollection(db, 'admins');
        const recipients = resolveInvoiceRecipients(settings, admins);
        if (recipients.length) {
          const subject = `Invoice: ${client.name || 'Client'} requested +${hoursNum}h`;
          const text = [
            `${client.name || 'A client'} requested additional retainer hours.`,
            '',
            `Hours: ${hoursNum}`,
            `Cycle: ${cycleOffset === 1 ? 'Next billing cycle' : 'Current billing cycle'}`,
            hourlyRate
              ? `Total (incl. 13% HST): $${total.toFixed(2)}`
              : 'Total: (set hourly rate on the client to auto-price)',
            notes ? `Notes: ${notes}` : '',
            '',
            `Open Billing: ${billingHref}`,
            `Requested by: ${caller.email}`,
          ]
            .filter(Boolean)
            .join('\n');
          const html = `<html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a;line-height:1.5;padding:24px;">
  <div style="max-width:560px;margin:0 auto;">
    <div style="font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#fd7414;">Ignite PM · Billing</div>
    <h1 style="font-size:20px;margin:8px 0 12px;">Add-on hours — invoice needed</h1>
    <p><strong>${String(client.name || 'Client').replace(/</g, '')}</strong> requested <strong>${hoursNum} hours</strong> (${cycleOffset === 1 ? 'next' : 'current'} cycle).</p>
    ${
      hourlyRate
        ? `<p>Subtotal $${subtotal.toFixed(2)} + HST $${hst.toFixed(2)} = <strong>$${total.toFixed(2)}</strong></p>`
        : ''
    }
    ${notes ? `<p style="color:#64748b;">Notes: ${notes.replace(/</g, '')}</p>` : ''}
    <p style="margin:24px 0;">
      <a href="${billingHref}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:14px 20px;border-radius:12px;font-size:12px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;">Open Billing</a>
    </p>
    <p style="color:#64748b;text-size:13px;">Requested by ${String(caller.email || '').replace(/</g, '')}</p>
  </div>
</body></html>`;
          await sendDigestEmail({ to: recipients, subject, text, html });
        } else {
          console.warn('[client-addon-request] no email recipients configured');
        }
      } catch (err) {
        console.warn('[client-addon-request] email:', err?.message || err);
      }
    }

    try {
      await writeClientActivity({
        clientId,
        clientName: client.name || '',
        type: 'addon_request',
        title: `Add-on hours: +${hoursNum}h`,
        body: notes.slice(0, 500) || `${hoursNum}h for ${cycleOffset === 1 ? 'next' : 'current'} cycle`,
        actorEmail: caller.email,
        source: 'system',
        meta: {
          addonId,
          hours: hoursNum,
          cycleTarget: cycleOffset === 1 ? 'next' : 'current',
          total,
          isClientPurchase,
        },
      });
    } catch (err) {
      console.warn('[client-addon-request] activity:', err?.message || err);
    }

    return new Response(
      JSON.stringify({ ok: true, id: addonId, addon: { id: addonId, ...addon } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[client-addon-request]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not submit add-on request.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

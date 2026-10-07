import { describeAuthError, requireClientOrStaffCaller } from './lib/requireAuth.mjs';
import { fetchDoc, getDigestDb } from './lib/firebaseDigestClient.mjs';
import {
  fetchCustomer,
  fetchInvoices,
  fetchPayments,
  loadCompanyConnection,
  normalizeCustomerId,
  shapeBilling,
  withQboAccess,
} from './lib/quickbooksOAuth.mjs';

/**
 * Portal/staff billing snapshot for one CRM client.
 * POST { clientId } → invoices, payments, open balance.
 */
function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function unavailable(warning) {
  return new Response(
    JSON.stringify({
      ok: true,
      available: false,
      warning,
      currency: 'CAD',
      customer: null,
      invoices: [],
      payments: [],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

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
  if (!clientId) {
    return new Response(JSON.stringify({ error: 'clientId is required.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    await requireClientOrStaffCaller(req.headers, clientId);
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

    const customerId = normalizeCustomerId(client.quickbooksCustomerId);
    if (!customerId) {
      return unavailable(
        'This client is not linked to a QuickBooks customer yet. Ask Ignite to link them on the CRM profile.',
      );
    }

    const conn = await loadCompanyConnection();
    if (!conn?.refreshToken || !conn?.realmId) {
      return unavailable('QuickBooks is not connected. Connect it in Admin → Config.');
    }

    const billing = await withQboAccess(conn, async (token) => {
      const [customer, invoices, payments] = await Promise.all([
        fetchCustomer(conn, token, customerId),
        fetchInvoices(conn, token, customerId),
        fetchPayments(conn, token, customerId),
      ]);
      return shapeBilling({ customer, invoices, payments, todayYmd: todayYmd() });
    });

    return new Response(
      JSON.stringify({
        ok: true,
        available: true,
        warning: '',
        ...billing,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[portal-quickbooks]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not load QuickBooks billing.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

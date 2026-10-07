import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import {
  loadCompanyConnection,
  queryCustomers,
  withQboAccess,
} from './lib/quickbooksOAuth.mjs';

/**
 * Admin/billing: search QuickBooks customers to link a CRM client.
 * POST { q?: string } → { customers: [{ id, name, company, email, balance }] }
 */
export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    await requireStaffCaller(req.headers, { roles: ['admin', 'billing'] });
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

  try {
    const conn = await loadCompanyConnection();
    if (!conn?.refreshToken) {
      return new Response(
        JSON.stringify({
          error: 'QuickBooks is not connected. Connect it in Admin → Config.',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const rows = await withQboAccess(conn, (token) => queryCustomers(conn, token, body.q));
    const customers = rows.map((row) => ({
      id: String(row?.Id || ''),
      name: String(row?.DisplayName || '').slice(0, 160),
      company: String(row?.CompanyName || '').slice(0, 160),
      email: String(row?.PrimaryEmailAddr?.Address || '').slice(0, 160),
      balance: Number(row?.Balance || 0),
    })).filter((row) => row.id);

    return new Response(JSON.stringify({ ok: true, customers }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[quickbooks-list-customers]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not list QuickBooks customers.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

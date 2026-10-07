import { describeAuthError, requireClientOrStaffCaller } from './lib/requireAuth.mjs';
import { fetchDoc, getDigestDb } from './lib/firebaseDigestClient.mjs';
import {
  fetchInvoice,
  fetchInvoicePdf,
  loadCompanyConnection,
  normalizeCustomerId,
  withQboAccess,
} from './lib/quickbooksOAuth.mjs';

/**
 * Portal/staff: download one invoice PDF after confirming it belongs to the
 * QuickBooks customer linked on this CRM client.
 * POST { clientId, invoiceId } → application/pdf
 */
function pdfName(invoice) {
  const raw = String(invoice?.DocNumber || invoice?.Id || 'invoice').replace(/[^\w.-]+/g, '-');
  return `invoice-${raw || 'invoice'}.pdf`;
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
  const invoiceId = normalizeCustomerId(body.invoiceId);
  if (!clientId || !invoiceId) {
    return new Response(JSON.stringify({ error: 'clientId and invoiceId are required.' }), {
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
      return new Response(JSON.stringify({ error: 'This client is not linked to QuickBooks.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const conn = await loadCompanyConnection();
    if (!conn?.refreshToken) {
      return new Response(JSON.stringify({ error: 'QuickBooks is not connected.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const pdf = await withQboAccess(conn, async (token) => {
      const invoice = await fetchInvoice(conn, token, invoiceId);
      const owner = normalizeCustomerId(invoice?.CustomerRef?.value);
      if (!invoice || owner !== customerId) {
        const err = new Error('That invoice is not on this client’s QuickBooks account.');
        err.status = 404;
        throw err;
      }
      const bytes = await fetchInvoicePdf(conn, token, invoiceId);
      return { bytes, name: pdfName(invoice) };
    });

    return new Response(pdf.bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${pdf.name}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    console.error('[quickbooks-invoice-pdf]', err);
    const status = err?.status === 404 ? 404 : 500;
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not download the invoice.' }),
      { status, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

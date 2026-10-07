/**
 * Company QuickBooks Online OAuth + Accounting API helpers.
 * Tokens live in Firestore quickbooksConnections/company; only the digest-bot
 * Firebase user (Netlify functions) may read or write them.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { fetchDoc, getDigestDb, mergeDoc, removeDoc } from './firebaseDigestClient.mjs';

export const QBO_SCOPE = 'com.intuit.quickbooks.accounting';
export const COMPANY_CONNECTION_ID = 'company';
const AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';

export function oauthConfig() {
  const clientId = String(process.env.QUICKBOOKS_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.QUICKBOOKS_CLIENT_SECRET || '').trim();
  const redirectUri = String(process.env.QUICKBOOKS_OAUTH_REDIRECT_URI || '').trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'Missing QUICKBOOKS_CLIENT_ID, QUICKBOOKS_CLIENT_SECRET, or QUICKBOOKS_OAUTH_REDIRECT_URI.',
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export function qboEnvironment() {
  const raw = String(process.env.QUICKBOOKS_ENVIRONMENT || 'production')
    .trim()
    .toLowerCase();
  return raw === 'sandbox' ? 'sandbox' : 'production';
}

export function qboApiHost(environment = qboEnvironment()) {
  return environment === 'sandbox'
    ? 'https://sandbox-quickbooks.api.intuit.com'
    : 'https://quickbooks.api.intuit.com';
}

function minorVersion() {
  const n = String(process.env.QUICKBOOKS_MINOR_VERSION || '75').replace(/[^\d]/g, '');
  return n || '75';
}

export function appBaseUrl() {
  return String(
    process.env.PORTAL_APP_URL ||
      process.env.URL ||
      process.env.DEPLOY_PRIME_URL ||
      'https://ignitetimetracker.netlify.app',
  ).replace(/\/$/, '');
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromB64url(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(b64, 'base64');
}

export function signQboOAuthState({ uid, email, expMs = Date.now() + 15 * 60 * 1000 }) {
  const { clientSecret } = oauthConfig();
  const payload = b64url(
    JSON.stringify({
      purpose: 'quickbooks',
      uid: String(uid || ''),
      email: String(email || '').trim().toLowerCase(),
      exp: Number(expMs) || Date.now() + 15 * 60 * 1000,
    }),
  );
  const sig = createHmac('sha256', clientSecret).update(payload).digest();
  return `${payload}.${b64url(sig)}`;
}

export function verifyQboOAuthState(state) {
  const { clientSecret } = oauthConfig();
  const raw = String(state || '');
  const i = raw.lastIndexOf('.');
  if (i <= 0) throw new Error('Invalid OAuth state.');
  const payload = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  const expected = createHmac('sha256', clientSecret).update(payload).digest();
  const got = fromB64url(sig);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    throw new Error('Invalid OAuth state signature.');
  }
  let data;
  try {
    data = JSON.parse(fromB64url(payload).toString('utf8'));
  } catch {
    throw new Error('Invalid OAuth state payload.');
  }
  if (data?.purpose !== 'quickbooks') throw new Error('Invalid OAuth state purpose.');
  if (!data?.uid || !data?.email) throw new Error('Invalid OAuth state payload.');
  if (Number(data.exp) < Date.now()) throw new Error('OAuth state expired — try Connect again.');
  return { uid: String(data.uid), email: String(data.email).toLowerCase() };
}

export function buildQboAuthUrl(state) {
  const { clientId, redirectUri } = oauthConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: QBO_SCOPE,
    state: String(state || ''),
  });
  return `${AUTH_URL}?${params}`;
}

function basicAuthHeader() {
  const { clientId, clientSecret } = oauthConfig();
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

export async function exchangeCodeForTokens(code) {
  const { redirectUri } = oauthConfig();
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: String(code || ''),
      redirect_uri: redirectUri,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.error_description || data?.error || 'Token exchange failed.');
  }
  return data;
}

export async function refreshAccessToken(refreshToken) {
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: String(refreshToken || ''),
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const detail = data?.error_description || data?.error || 'Token refresh failed.';
    const err = new Error(detail);
    err.code = data?.error || 'token_refresh_failed';
    if (/invalid_grant|expired|revoked/i.test(String(detail))) err.reconnectRequired = true;
    throw err;
  }
  return data;
}

export async function revokeToken(token) {
  if (!token) return;
  try {
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(),
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: String(token) }),
    });
  } catch {
    /* best-effort */
  }
}

export function connectionPath(id = COMPANY_CONNECTION_ID) {
  return `quickbooksConnections/${String(id || COMPANY_CONNECTION_ID).trim()}`;
}

export async function loadCompanyConnection() {
  const db = await getDigestDb();
  const data = await fetchDoc(db, connectionPath());
  return data ? { id: COMPANY_CONNECTION_ID, ...data } : null;
}

export async function saveCompanyConnection(fields) {
  const db = await getDigestDb();
  await mergeDoc(db, connectionPath(), {
    ...fields,
    id: COMPANY_CONNECTION_ID,
    updatedAt: Date.now(),
  });
}

export async function deleteCompanyConnection() {
  const db = await getDigestDb();
  await removeDoc(db, connectionPath());
}

export function publicConnectionStatus(connection) {
  if (!connection?.refreshToken || !connection?.realmId) {
    return {
      connected: false,
      companyName: '',
      realmId: '',
      environment: qboEnvironment(),
      connectedAt: null,
      connectedByEmail: '',
    };
  }
  return {
    connected: true,
    companyName: connection.companyName || '',
    realmId: String(connection.realmId),
    environment: connection.environment === 'sandbox' ? 'sandbox' : 'production',
    connectedAt: Number(connection.connectedAt || 0) || null,
    connectedByEmail: connection.connectedByEmail || '',
  };
}

export async function getValidAccessToken(connection) {
  if (!connection?.refreshToken && !connection?.accessToken) {
    const err = new Error('QuickBooks is not connected. Connect it in Admin → Config.');
    err.reconnectRequired = true;
    throw err;
  }
  const skew = 60_000;
  const expiry = Number(connection.expiry || 0);
  if (connection.accessToken && expiry > Date.now() + skew) {
    return connection.accessToken;
  }
  if (!connection.refreshToken) {
    const err = new Error('QuickBooks connection expired — reconnect in Admin → Config.');
    err.reconnectRequired = true;
    throw err;
  }
  try {
    const refreshed = await refreshAccessToken(connection.refreshToken);
    const accessToken = refreshed.access_token;
    if (!accessToken) throw new Error('QuickBooks did not return an access token.');
    await saveCompanyConnection({
      accessToken,
      expiry: Date.now() + Number(refreshed.expires_in || 3600) * 1000,
      ...(refreshed.refresh_token ? { refreshToken: refreshed.refresh_token } : {}),
    });
    return accessToken;
  } catch (err) {
    if (err?.reconnectRequired) {
      throw new Error(
        'QuickBooks access expired or was revoked. Reconnect in Admin → Config.',
      );
    }
    throw err;
  }
}

export function normalizeCustomerId(raw) {
  const id = String(raw || '').replace(/[^\d]/g, '');
  if (!id || id.length > 20) return '';
  return id;
}

export function normalizeRealmId(raw) {
  const id = String(raw || '').replace(/[^\d]/g, '');
  if (!id || id.length > 30) return '';
  return id;
}

/** Strip wildcards and quotes so a customer search cannot change the QBO query. */
export function quickbooksSearchTerm(raw) {
  return String(raw || '')
    .replace(/[%_\\']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

export function safeInvoicePayUrl(raw) {
  try {
    const url = new URL(String(raw || '').trim());
    if (url.protocol !== 'https:') return '';
    const host = url.hostname.toLowerCase();
    if (host !== 'intuit.com' && !host.endsWith('.intuit.com')) return '';
    return url.toString();
  } catch {
    return '';
  }
}

export function invoiceStatus(invoice, todayYmd) {
  const balance = Number(invoice?.Balance || 0);
  const total = Number(invoice?.TotalAmt || 0);
  if (balance <= 0.009) return 'paid';
  const due = String(invoice?.DueDate || '').slice(0, 10);
  if (due && todayYmd && due < todayYmd) return 'overdue';
  if (total > 0 && balance < total - 0.009) return 'partial';
  return 'open';
}

function qboFaultMessage(data, status) {
  const fault = data?.Fault?.Error?.[0];
  return (
    fault?.Detail ||
    fault?.Message ||
    data?.error_description ||
    data?.error ||
    `QuickBooks HTTP ${status}`
  );
}

async function qboFetch(connection, accessToken, pathAndQuery, { accept = 'application/json' } = {}) {
  const realmId = normalizeRealmId(connection?.realmId);
  if (!realmId) throw new Error('QuickBooks company id is missing. Reconnect in Admin → Config.');
  const host = qboApiHost(connection?.environment || qboEnvironment());
  const joiner = pathAndQuery.includes('?') ? '&' : '?';
  const url = `${host}/v3/company/${realmId}${pathAndQuery}${joiner}minorversion=${minorVersion()}`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: accept,
    },
  });
  if (accept === 'application/pdf') {
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      const err = new Error(qboFaultMessage(data, resp.status));
      err.status = resp.status;
      throw err;
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    return buf;
  }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error(qboFaultMessage(data, resp.status));
    err.status = resp.status;
    throw err;
  }
  return data;
}

export async function withQboAccess(connection, run) {
  let token = await getValidAccessToken(connection);
  try {
    return await run(token);
  } catch (err) {
    if (err?.status !== 401 || !connection?.refreshToken) throw err;
    const refreshed = await refreshAccessToken(connection.refreshToken);
    token = refreshed.access_token;
    if (!token) throw err;
    await saveCompanyConnection({
      accessToken: token,
      expiry: Date.now() + Number(refreshed.expires_in || 3600) * 1000,
      ...(refreshed.refresh_token ? { refreshToken: refreshed.refresh_token } : {}),
    });
    return run(token);
  }
}

export async function fetchCompanyInfo(connection, accessToken) {
  const realmId = normalizeRealmId(connection?.realmId);
  const data = await qboFetch(connection, accessToken, `/companyinfo/${realmId}`);
  return data?.CompanyInfo || null;
}

export async function queryCustomers(connection, accessToken, search) {
  const term = quickbooksSearchTerm(search);
  const where = term
    ? `WHERE Active = true AND DisplayName LIKE '%${term}%'`
    : 'WHERE Active = true';
  const sql = `SELECT Id, DisplayName, CompanyName, Balance, PrimaryEmailAddr FROM Customer ${where} ORDERBY DisplayName STARTPOSITION 1 MAXRESULTS 25`;
  const data = await qboFetch(
    connection,
    accessToken,
    `/query?query=${encodeURIComponent(sql)}`,
  );
  const rows = data?.QueryResponse?.Customer;
  return Array.isArray(rows) ? rows : [];
}

export async function fetchCustomer(connection, accessToken, customerId) {
  const id = normalizeCustomerId(customerId);
  if (!id) throw new Error('QuickBooks customer id is missing.');
  const data = await qboFetch(connection, accessToken, `/customer/${id}`);
  return data?.Customer || null;
}

async function queryEntity(connection, accessToken, entity, customerId) {
  const id = normalizeCustomerId(customerId);
  const sql = `SELECT * FROM ${entity} WHERE CustomerRef = '${id}' ORDERBY TxnDate DESC STARTPOSITION 1 MAXRESULTS 50`;
  const data = await qboFetch(
    connection,
    accessToken,
    `/query?query=${encodeURIComponent(sql)}`,
  );
  const rows = data?.QueryResponse?.[entity];
  return Array.isArray(rows) ? rows : [];
}

export function fetchInvoices(connection, accessToken, customerId) {
  return queryEntity(connection, accessToken, 'Invoice', customerId);
}

export function fetchPayments(connection, accessToken, customerId) {
  return queryEntity(connection, accessToken, 'Payment', customerId);
}

export async function fetchInvoice(connection, accessToken, invoiceId) {
  const id = normalizeCustomerId(invoiceId);
  if (!id) throw new Error('Invoice id is missing.');
  const data = await qboFetch(connection, accessToken, `/invoice/${id}`);
  return data?.Invoice || null;
}

export function fetchInvoicePdf(connection, accessToken, invoiceId) {
  const id = normalizeCustomerId(invoiceId);
  if (!id) throw new Error('Invoice id is missing.');
  return qboFetch(connection, accessToken, `/invoice/${id}/pdf`, {
    accept: 'application/pdf',
  });
}

function money(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0;
}

export function shapeBilling({ customer, invoices, payments, todayYmd }) {
  const currency =
    customer?.CurrencyRef?.value ||
    invoices?.[0]?.CurrencyRef?.value ||
    payments?.[0]?.CurrencyRef?.value ||
    'CAD';
  const shapedInvoices = (Array.isArray(invoices) ? invoices : []).map((inv) => ({
    id: String(inv?.Id || ''),
    number: String(inv?.DocNumber || inv?.Id || ''),
    date: String(inv?.TxnDate || '').slice(0, 10),
    dueDate: String(inv?.DueDate || '').slice(0, 10),
    total: money(inv?.TotalAmt),
    balance: money(inv?.Balance),
    status: invoiceStatus(inv, todayYmd),
    payUrl: safeInvoicePayUrl(inv?.InvoiceLink),
  })).filter((inv) => inv.id);

  const shapedPayments = (Array.isArray(payments) ? payments : []).map((pmt) => ({
    id: String(pmt?.Id || ''),
    date: String(pmt?.TxnDate || '').slice(0, 10),
    amount: money(pmt?.TotalAmt),
    ref: String(pmt?.PaymentRefNum || '').slice(0, 40),
    unapplied: money(pmt?.UnappliedAmt),
  })).filter((pmt) => pmt.id);

  return {
    currency: String(currency || 'CAD').slice(0, 8),
    customer: {
      id: String(customer?.Id || ''),
      name: String(customer?.DisplayName || customer?.CompanyName || '').slice(0, 160),
      balance: money(customer?.Balance),
    },
    invoices: shapedInvoices,
    payments: shapedPayments,
  };
}

import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import {
  getValidAdsAccessToken,
  listAccessibleCustomers,
} from './lib/googleAdsOAuth.mjs';

/**
 * Admin/billing: list Google Ads customers visible to the connected account.
 * POST → { customers: [{ customerId, descriptiveName }] }
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

  try {
    const { accessToken } = await getValidAdsAccessToken();
    const customers = await listAccessibleCustomers(accessToken);
    return new Response(JSON.stringify({ ok: true, customers }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[google-ads-list-customers]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not list Google Ads customers.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

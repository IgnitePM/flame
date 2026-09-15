import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import { getValidGa4AccessToken, listGa4Properties } from './lib/ga4OAuth.mjs';

/**
 * Admin/billing: list GA4 properties visible to the connected Google account.
 * POST → { properties: [{ propertyId, displayName, accountName }] }
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
    const { accessToken } = await getValidGa4AccessToken();
    const properties = await listGa4Properties(accessToken);
    return new Response(JSON.stringify({ ok: true, properties }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[ga4-list-properties]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not list GA4 properties.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

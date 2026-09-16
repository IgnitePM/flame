import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import { getValidGbpAccessToken, listGbpLocations } from './lib/gbpOAuth.mjs';

/**
 * Admin/billing: list Business Profile locations visible to the connected account.
 * POST → { locations: [{ locationId, displayName, accountName, address }] }
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
    const { accessToken } = await getValidGbpAccessToken();
    const locations = await listGbpLocations(accessToken);
    return new Response(JSON.stringify({ ok: true, locations }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[gbp-list-locations]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not list GBP locations.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import {
  deleteCompanyConnection,
  loadCompanyConnection,
  revokeToken,
} from './lib/googleAdsOAuth.mjs';

/**
 * Admin/billing: disconnect company Google Ads.
 * POST → { ok: true }
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
    const conn = await loadCompanyConnection();
    if (conn) {
      await revokeToken(conn.refreshToken || conn.accessToken);
      await deleteCompanyConnection();
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[google-ads-oauth-disconnect]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not disconnect Google Ads.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

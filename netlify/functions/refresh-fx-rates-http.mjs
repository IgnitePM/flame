import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import { refreshFxRatesToFirestore } from './lib/fxRates.mjs';

/**
 * Manual FX refresh for admins/billing (or first-time seed).
 * POST with Firebase ID token. Returns { rates, asOf, source, updatedAt }.
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
    const result = await refreshFxRatesToFirestore();
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[refresh-fx-rates-http]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Could not refresh FX rates.' }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
};

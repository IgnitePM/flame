import {
  appBaseUrl,
  exchangeCodeForTokens,
  loadConnection,
  saveConnection,
  verifyCalendarOAuthState,
} from './lib/calendarOAuth.mjs';

/**
 * Google OAuth redirect target. Exchanges code, stores tokens, redirects to kiosk.
 * GET ?code=&state=  (or ?error=)
 */
export default async (req) => {
  const url = new URL(req.url);
  const base = appBaseUrl();
  const kioskUrl = `${base}/kiosk?calendar=`;

  const fail = (reason) =>
    Response.redirect(
      `${kioskUrl}error&calendarMsg=${encodeURIComponent(reason)}`,
      302,
    );

  const errParam = url.searchParams.get('error');
  if (errParam) {
    return fail(url.searchParams.get('error_description') || errParam);
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return fail('Missing OAuth code.');

  try {
    const { uid, email } = verifyCalendarOAuthState(state);
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.access_token) throw new Error('No access token returned.');

    const now = Date.now();
    const fields = {
      uid,
      staffEmail: email,
      calendarEmail: email,
      accessToken: tokens.access_token,
      expiry: now + Number(tokens.expires_in || 3600) * 1000,
      connectedAt: now,
      updatedAt: now,
    };
    if (tokens.refresh_token) {
      fields.refreshToken = tokens.refresh_token;
    } else {
      const existing = await loadConnection(uid);
      if (existing?.refreshToken) fields.refreshToken = existing.refreshToken;
    }
    if (!fields.refreshToken) {
      throw new Error(
        'Google did not return a refresh token. Disconnect and Connect again with consent.',
      );
    }

    await saveConnection(uid, fields);
    return Response.redirect(`${kioskUrl}connected`, 302);
  } catch (err) {
    console.error('[calendar-oauth-callback]', err);
    return fail(err?.message || 'Calendar connect failed.');
  }
};

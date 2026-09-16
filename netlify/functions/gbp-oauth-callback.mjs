import {
  appBaseUrl,
  exchangeCodeForTokens,
  fetchGoogleUserEmail,
  loadCompanyConnection,
  saveCompanyConnection,
  verifyGbpOAuthState,
} from './lib/gbpOAuth.mjs';

/**
 * Google OAuth redirect target for company Business Profile.
 * GET ?code=&state=  (or ?error=)
 */
export default async (req) => {
  const url = new URL(req.url);
  const base = appBaseUrl();
  const configUrl = `${base}/admin?gbp=`;

  const fail = (reason) =>
    Response.redirect(`${configUrl}error&gbpMsg=${encodeURIComponent(reason)}`, 302);

  const errParam = url.searchParams.get('error');
  if (errParam) {
    return fail(url.searchParams.get('error_description') || errParam);
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return fail('Missing OAuth code.');

  try {
    const { uid, email } = verifyGbpOAuthState(state);
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.access_token) throw new Error('No access token returned.');

    const gbpEmail = (await fetchGoogleUserEmail(tokens.access_token)) || email;
    const now = Date.now();
    const existing = await loadCompanyConnection();
    const fields = {
      gbpEmail,
      accessToken: tokens.access_token,
      expiry: now + Number(tokens.expires_in || 3600) * 1000,
      connectedAt: existing?.connectedAt || now,
      updatedAt: now,
      connectedByUid: uid,
      connectedByEmail: email,
    };
    if (tokens.refresh_token) {
      fields.refreshToken = tokens.refresh_token;
    } else if (existing?.refreshToken) {
      fields.refreshToken = existing.refreshToken;
    }
    if (!fields.refreshToken) {
      throw new Error(
        'Google did not return a refresh token. Disconnect and Connect again with consent.',
      );
    }

    await saveCompanyConnection(fields);
    return Response.redirect(`${configUrl}connected`, 302);
  } catch (err) {
    console.error('[gbp-oauth-callback]', err);
    return fail(err?.message || 'GBP connect failed.');
  }
};

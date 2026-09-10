import {
  appBaseUrl,
  exchangeCodeForTokens,
  fetchGmailProfile,
  saveConnection,
  verifyOAuthState,
} from './lib/gmailOAuth.mjs';

/**
 * Google OAuth redirect target. Exchanges code, stores tokens, redirects to Config.
 * GET ?code=&state=  (or ?error=)
 */
export default async (req) => {
  const url = new URL(req.url);
  const base = appBaseUrl();
  const configUrl = `${base}/admin?gmail=`;

  const fail = (reason) =>
    Response.redirect(`${configUrl}error&gmailMsg=${encodeURIComponent(reason)}`, 302);

  const errParam = url.searchParams.get('error');
  if (errParam) {
    return fail(url.searchParams.get('error_description') || errParam);
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return fail('Missing OAuth code.');

  try {
    const { uid, email } = verifyOAuthState(state);
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.access_token) throw new Error('No access token returned.');

    const profile = await fetchGmailProfile(tokens.access_token);
    const gmailEmail = String(profile?.emailAddress || email).trim().toLowerCase();
    const now = Date.now();
    const fields = {
      uid,
      staffEmail: email,
      gmailEmail,
      accessToken: tokens.access_token,
      expiry: now + Number(tokens.expires_in || 3600) * 1000,
      connectedAt: now,
      updatedAt: now,
      historyId: profile?.historyId ? String(profile.historyId) : null,
    };
    if (tokens.refresh_token) {
      fields.refreshToken = tokens.refresh_token;
    } else {
      // Re-consent without refresh_token — keep existing refresh if any
      const { loadConnection } = await import('./lib/gmailOAuth.mjs');
      const existing = await loadConnection(uid);
      if (existing?.refreshToken) fields.refreshToken = existing.refreshToken;
    }
    if (!fields.refreshToken) {
      throw new Error('Google did not return a refresh token. Disconnect and Connect again with consent.');
    }

    await saveConnection(uid, fields);
    return Response.redirect(`${configUrl}connected`, 302);
  } catch (err) {
    console.error('[gmail-oauth-callback]', err);
    return fail(err?.message || 'Gmail connect failed.');
  }
};

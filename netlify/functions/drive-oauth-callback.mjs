import {
  appBaseUrl,
  exchangeCodeForTokens,
  fetchGoogleUserEmail,
  loadCompanyConnection,
  saveCompanyConnection,
  verifyDriveOAuthState,
} from './lib/driveOAuth.mjs';

/**
 * Google OAuth redirect target for company Drive.
 * GET ?code=&state=  (or ?error=)
 */
export default async (req) => {
  const url = new URL(req.url);
  const base = appBaseUrl();
  const configUrl = `${base}/admin?drive=`;

  const fail = (reason) =>
    Response.redirect(`${configUrl}error&driveMsg=${encodeURIComponent(reason)}`, 302);

  const errParam = url.searchParams.get('error');
  if (errParam) {
    return fail(url.searchParams.get('error_description') || errParam);
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return fail('Missing OAuth code.');

  try {
    const { uid, email } = verifyDriveOAuthState(state);
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.access_token) throw new Error('No access token returned.');

    const driveEmail = (await fetchGoogleUserEmail(tokens.access_token)) || email;
    const now = Date.now();
    const existing = await loadCompanyConnection();
    const fields = {
      driveEmail,
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
    // Keep existing root selection across reconnect.
    if (existing?.rootFolderId) {
      fields.rootFolderId = existing.rootFolderId;
      fields.rootFolderName = existing.rootFolderName || '';
      fields.sharedDriveId = existing.sharedDriveId || '';
    }

    await saveCompanyConnection(fields);
    return Response.redirect(`${configUrl}connected`, 302);
  } catch (err) {
    console.error('[drive-oauth-callback]', err);
    return fail(err?.message || 'Drive connect failed.');
  }
};

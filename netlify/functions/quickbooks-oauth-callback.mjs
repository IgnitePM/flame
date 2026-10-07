import {
  appBaseUrl,
  exchangeCodeForTokens,
  fetchCompanyInfo,
  loadCompanyConnection,
  normalizeRealmId,
  qboEnvironment,
  saveCompanyConnection,
  verifyQboOAuthState,
} from './lib/quickbooksOAuth.mjs';

/**
 * Intuit OAuth redirect. Exchanges the code, stores tokens, returns to Config.
 * GET ?code=&state=&realmId=
 */
export default async (req) => {
  const url = new URL(req.url);
  const base = appBaseUrl();
  const configUrl = `${base}/admin?qbo=`;

  const fail = (reason) =>
    Response.redirect(`${configUrl}error&qboMsg=${encodeURIComponent(reason)}`, 302);

  const errParam = url.searchParams.get('error');
  if (errParam) {
    return fail(url.searchParams.get('error_description') || errParam);
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const realmId = normalizeRealmId(url.searchParams.get('realmId'));
  if (!code || !state) return fail('Missing OAuth code.');
  if (!realmId) return fail('QuickBooks did not return a company id.');

  try {
    const { uid, email } = verifyQboOAuthState(state);
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.access_token) throw new Error('No access token returned.');

    const now = Date.now();
    const existing = await loadCompanyConnection();
    const environment = qboEnvironment();
    const draft = {
      realmId,
      environment,
      accessToken: tokens.access_token,
      expiry: now + Number(tokens.expires_in || 3600) * 1000,
    };
    let companyName = '';
    try {
      const info = await fetchCompanyInfo(draft, tokens.access_token);
      companyName = String(info?.CompanyName || '').trim();
    } catch (err) {
      console.error('[quickbooks-oauth-callback] companyinfo', err?.message || err);
    }

    const fields = {
      realmId,
      environment,
      companyName,
      accessToken: tokens.access_token,
      expiry: draft.expiry,
      connectedAt: existing?.connectedAt || now,
      connectedByUid: uid,
      connectedByEmail: email,
    };
    if (tokens.refresh_token) {
      fields.refreshToken = tokens.refresh_token;
    } else if (existing?.refreshToken && existing?.realmId === realmId) {
      fields.refreshToken = existing.refreshToken;
    }
    if (!fields.refreshToken) {
      throw new Error(
        'QuickBooks did not return a refresh token. Disconnect and Connect again.',
      );
    }

    await saveCompanyConnection(fields);
    return Response.redirect(`${configUrl}connected`, 302);
  } catch (err) {
    console.error('[quickbooks-oauth-callback]', err);
    return fail(err?.message || 'QuickBooks connect failed.');
  }
};

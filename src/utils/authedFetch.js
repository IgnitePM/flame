import { auth } from '../firebase';

/**
 * POST helper that attaches the caller's Firebase ID token so the Netlify
 * functions can verify who is asking. Fails fast when nobody is signed in so
 * the UI shows a clear message instead of surfacing a raw 401 body.
 */
export async function authedFetch(url, body) {
  const current = auth.currentUser;
  if (!current) {
    throw new Error('You are signed out — sign in again to continue.');
  }
  const token = await current.getIdToken();
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

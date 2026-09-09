/**
 * Refresh ECB reference FX rates (via Frankfurter) into settings/fxRates.
 * Used by the scheduled Netlify function and optional manual trigger.
 */

import { getDigestDb, mergeDoc } from './firebaseDigestClient.mjs';

const FRANKFURTER_URL =
  'https://api.frankfurter.app/latest?from=CAD&to=USD,EUR,GBP';

function ratesToCadFromFrankfurter(payload) {
  const foreign = payload?.rates || {};
  const rates = { CAD: 1 };
  for (const code of ['USD', 'EUR', 'GBP']) {
    const perCad = Number(foreign[code]);
    if (Number.isFinite(perCad) && perCad > 0) {
      rates[code] = 1 / perCad;
    }
  }
  return rates;
}

export async function refreshFxRatesToFirestore() {
  const resp = await fetch(FRANKFURTER_URL, {
    headers: { Accept: 'application/json' },
  });
  if (!resp.ok) {
    throw new Error(`FX fetch failed (${resp.status})`);
  }
  const payload = await resp.json();
  const rates = ratesToCadFromFrankfurter(payload);
  if (!Number.isFinite(rates.USD) || rates.USD <= 0) {
    throw new Error('FX fetch returned invalid USD rate');
  }
  const doc = {
    rates,
    asOf: payload?.date || null,
    source: 'frankfurter',
    updatedAt: Date.now(),
  };
  const db = await getDigestDb();
  await mergeDoc(db, 'settings/fxRates', doc);
  return doc;
}

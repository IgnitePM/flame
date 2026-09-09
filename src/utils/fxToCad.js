/** Fallback FX when live rates are unavailable. All expense amounts are stored in CAD. */
export const FALLBACK_FX_TO_CAD = {
  CAD: 1,
  USD: 1.36,
  EUR: 1.47,
  GBP: 1.72,
};

/** @deprecated Prefer getFxToCad(liveRates) — kept for older imports. */
export const FX_TO_CAD = FALLBACK_FX_TO_CAD;

const FX_CURRENCIES = ['USD', 'EUR', 'GBP'];

/** Frankfurter (ECB reference rates). No API key. */
export const FRANKFURTER_LATEST_URL =
  'https://api.frankfurter.app/latest?from=CAD&to=USD,EUR,GBP';

/**
 * Merge live rates (multipliers to CAD) with fallbacks.
 * @param {Record<string, number>|null|undefined} live
 */
export function getFxToCad(live) {
  const out = { ...FALLBACK_FX_TO_CAD };
  if (!live || typeof live !== 'object') return out;
  for (const code of ['CAD', ...FX_CURRENCIES]) {
    const n = Number(live[code]);
    if (Number.isFinite(n) && n > 0) out[code] = n;
  }
  out.CAD = 1;
  return out;
}

export function amountToCad(amount, currency = 'CAD', liveRates = null) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  const table = getFxToCad(liveRates);
  return n * (table[currency] ?? 1);
}

/**
 * Parse Frankfurter "from CAD" payload into multipliers TO CAD
 * (how many CAD per 1 unit of foreign currency).
 */
export function ratesToCadFromFrankfurter(payload) {
  const foreign = payload?.rates || {};
  const rates = { CAD: 1 };
  for (const code of FX_CURRENCIES) {
    const perCad = Number(foreign[code]);
    if (Number.isFinite(perCad) && perCad > 0) {
      rates[code] = 1 / perCad;
    }
  }
  return {
    rates,
    asOf: payload?.date || null,
    source: 'frankfurter',
  };
}

/** Browser / Node fetch of latest ECB rates via Frankfurter. */
export async function fetchLiveFxToCad() {
  const resp = await fetch(FRANKFURTER_LATEST_URL, {
    headers: { Accept: 'application/json' },
  });
  if (!resp.ok) {
    throw new Error(`FX fetch failed (${resp.status})`);
  }
  const payload = await resp.json();
  const parsed = ratesToCadFromFrankfurter(payload);
  if (!Number.isFinite(parsed.rates.USD) || parsed.rates.USD <= 0) {
    throw new Error('FX fetch returned invalid USD rate');
  }
  return {
    ...parsed,
    updatedAt: Date.now(),
  };
}

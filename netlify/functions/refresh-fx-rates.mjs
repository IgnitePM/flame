import { refreshFxRatesToFirestore } from './lib/fxRates.mjs';

/**
 * Keep expense FX rates fresh (ECB reference via Frankfurter → settings/fxRates).
 * Weekdays matter most; running daily is fine (weekend repeats Friday's rate).
 */
export default async () => {
  try {
    const result = await refreshFxRatesToFirestore();
    console.log(
      '[refresh-fx-rates]',
      JSON.stringify({
        asOf: result.asOf,
        USD: result.rates?.USD,
        EUR: result.rates?.EUR,
        GBP: result.rates?.GBP,
      }),
    );
  } catch (err) {
    console.error('[refresh-fx-rates] failed:', err);
    throw err;
  }
};

// Daily ~15:00 UTC (after typical ECB publish window).
export const config = { schedule: '0 15 * * *' };

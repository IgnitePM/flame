import { FX_TO_CAD } from './fxToCad.js';

/** Perplexity Computer Credits: 1 credit = $0.01 USD (then converted to CAD). */
export const PERPLEXITY_CREDIT_USD_VALUE = 0.01;
export const PERPLEXITY_EXPENSE_MARKUP = 1.3;

/** @deprecated Use PERPLEXITY_CREDIT_USD_VALUE — credits are billed in USD. */
export const PERPLEXITY_CREDIT_CAD_VALUE = PERPLEXITY_CREDIT_USD_VALUE;

export function perplexityCreditsToRawUsd(credits) {
  const n = Number(credits);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n * PERPLEXITY_CREDIT_USD_VALUE;
}

/** USD credit cost converted to CAD (for storage / retainer math). */
export function perplexityCreditsToRawCad(credits, usdToCad = FX_TO_CAD.USD) {
  return perplexityCreditsToRawUsd(credits) * Number(usdToCad || FX_TO_CAD.USD);
}

export function computePerplexityExpenseAmounts(
  credits,
  { applyMarkup = true, hourlyRate = 0, isDollar = false, usdToCad = FX_TO_CAD.USD } = {},
) {
  const fx = Number(usdToCad || FX_TO_CAD.USD);
  const rawUsd = perplexityCreditsToRawUsd(credits);
  const rawAmount = rawUsd * fx; // CAD
  const shouldMarkup = applyMarkup && !isDollar;
  const finalCost = shouldMarkup ? rawAmount * PERPLEXITY_EXPENSE_MARKUP : rawAmount;
  const rate = Number(hourlyRate || 0);
  const equivalentHours = isDollar || rate <= 0 ? 0 : finalCost / rate;
  return {
    credits: Number(credits),
    rawUsd,
    rawAmount,
    finalCost,
    equivalentHours,
    applyMarkup: shouldMarkup,
    usdToCad: fx,
  };
}

export function buildPerplexityExpenseDescription(credits, userDescription = '') {
  const n = Number(credits);
  const base = `Perplexity Computer Credits (${Number.isFinite(n) ? n.toLocaleString() : '0'} credits)`;
  const trimmed = String(userDescription || '').trim();
  return trimmed ? `${base} — ${trimmed}` : base;
}


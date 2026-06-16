/** Perplexity Computer Credits: 1 credit = $0.01 CAD. */
export const PERPLEXITY_CREDIT_CAD_VALUE = 0.01;
export const PERPLEXITY_EXPENSE_MARKUP = 1.3;

export function perplexityCreditsToRawCad(credits) {
  const n = Number(credits);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n * PERPLEXITY_CREDIT_CAD_VALUE;
}

export function computePerplexityExpenseAmounts(credits, { applyMarkup = true, hourlyRate = 0, isDollar = false } = {}) {
  const rawAmount = perplexityCreditsToRawCad(credits);
  const shouldMarkup = applyMarkup && !isDollar;
  const finalCost = shouldMarkup ? rawAmount * PERPLEXITY_EXPENSE_MARKUP : rawAmount;
  const rate = Number(hourlyRate || 0);
  const equivalentHours = isDollar || rate <= 0 ? 0 : finalCost / rate;
  return {
    credits: Number(credits),
    rawAmount,
    finalCost,
    equivalentHours,
    applyMarkup: shouldMarkup,
  };
}

export function buildPerplexityExpenseDescription(credits, userDescription = '') {
  const n = Number(credits);
  const base = `Perplexity Computer Credits (${Number.isFinite(n) ? n.toLocaleString() : '0'} credits)`;
  const trimmed = String(userDescription || '').trim();
  return trimmed ? `${base} — ${trimmed}` : base;
}

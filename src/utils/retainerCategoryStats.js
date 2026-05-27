export function computeRetainerDaysLeft(cycleEndMs, now = Date.now()) {
  if (!cycleEndMs) return null;
  return Math.max(0, Math.ceil((cycleEndMs - now) / 86400000));
}

export function formatRetainerAmount(value, isDollar, { decimals = 2 } = {}) {
  const n = Number(value || 0).toFixed(decimals);
  return isDollar ? `$${n}` : `${n}h`;
}

/** Normalize per-category stats from getGlobalRetainerStats().perCategory[cat]. */
export function buildRetainerCategorySummary(catStats, { baseFallback = 0 } = {}) {
  const used = Number(catStats?.used ?? 0);
  const baseActive = Number(catStats?.baseActive ?? baseFallback ?? 0);
  const carryover = Number(catStats?.carryover ?? 0);
  const addonPrior = Number(catStats?.addonHoursPriorCycle ?? 0);
  const addonThis = Number(catStats?.addonHoursThisCycle ?? 0);
  const hourMoveNet = Number(catStats?.hourMoveNet ?? 0);
  const adjustedAllotted = Number(
    catStats?.adjustedAllotted ?? baseActive + carryover + addonPrior + addonThis + hourMoveNet,
  );
  const remaining = adjustedAllotted - used;
  const isOver =
    catStats?.isOver ??
    (adjustedAllotted > 0 ? used > adjustedAllotted : used > 0);
  const percent =
    catStats?.percent ??
    (adjustedAllotted > 0
      ? Math.min(100, Math.max(0, (used / adjustedAllotted) * 100))
      : used > 0
        ? 100
        : 0);

  return {
    used,
    baseActive,
    carryover,
    addonPrior,
    addonThis,
    hourMoveNet,
    adjustedAllotted,
    remaining,
    isOver,
    percent,
    isDollar: !!catStats?.isDollar,
  };
}

export function buildRetainerCategoryBreakdownParts(summary, isDollar) {
  const fmt = (n) => formatRetainerAmount(n, isDollar);
  const parts = [];
  parts.push(`Per cycle: ${fmt(summary.baseActive)}`);
  if (summary.carryover !== 0) {
    parts.push(
      `Carryover: ${summary.carryover > 0 ? '+' : ''}${fmt(summary.carryover)}`,
    );
  }
  if (summary.addonPrior > 0) {
    parts.push(`Prior add-ons: +${fmt(summary.addonPrior)}`);
  }
  if (summary.addonThis > 0) {
    parts.push(`Add-ons: +${fmt(summary.addonThis)}`);
  }
  if (!isDollar && summary.hourMoveNet !== 0) {
    parts.push(
      `Moves: ${summary.hourMoveNet > 0 ? '+' : ''}${fmt(summary.hourMoveNet)}`,
    );
  }
  return parts;
}

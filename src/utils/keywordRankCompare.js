/**
 * Client-side keyword rank comparison helpers (SE Ranking position series).
 */

export function addDaysYmd(ymdStr, days) {
  const d = new Date(`${ymdStr}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymdStr;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Closest check on/near targetYmd (within maxDays). */
export function pickCheckNearDate(checks, targetYmd, maxDays = 3) {
  if (!Array.isArray(checks) || !checks.length || !targetYmd) return null;
  let best = null;
  let bestDiff = Infinity;
  const target = new Date(`${targetYmd}T12:00:00Z`).getTime();
  for (const p of checks) {
    const d = String(p?.date || '');
    if (!d) continue;
    const diff = Math.abs(new Date(`${d}T12:00:00Z`).getTime() - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = p;
    }
  }
  if (bestDiff > maxDays * 86400000) return null;
  return best;
}

export function uniqueSortedCheckDates(keywordRows = []) {
  const set = new Set();
  for (const row of keywordRows) {
    for (const p of row?.checks || []) {
      if (p?.date) set.add(String(p.date));
    }
  }
  return [...set].sort();
}

/**
 * Default compare pair: latest check vs ~7 days earlier (WoW),
 * falling back to first/last available dates.
 */
export function defaultCompareDates(checkDates = [], checkpoints = {}) {
  const dates = Array.isArray(checkDates) ? checkDates.filter(Boolean) : [];
  const latest =
    String(checkpoints.current || '').trim() ||
    (dates.length ? dates[dates.length - 1] : '');
  if (!latest) {
    return { baselineDate: '', compareDate: '' };
  }
  const weekAgo =
    String(checkpoints['7days'] || checkpoints['7_days'] || '').trim() ||
    addDaysYmd(latest, -7);
  let baseline = dates.includes(weekAgo)
    ? weekAgo
    : pickCheckNearDate(
        dates.map((date) => ({ date })),
        weekAgo,
        4,
      )?.date || '';
  if (!baseline && dates.length >= 2) {
    baseline = dates[Math.max(0, dates.length - 2)];
  }
  if (!baseline) baseline = dates[0] || '';
  if (baseline === latest && dates.length >= 2) {
    baseline = dates[0];
  }
  return { baselineDate: baseline, compareDate: latest };
}

/**
 * Apply baseline/compare dates onto a keyword row that includes `checks`.
 * Positive delta = improved (lower rank number).
 */
export function applyKeywordDateCompare(row, baselineDate, compareDate) {
  const checks = Array.isArray(row?.checks) ? row.checks : [];
  // Calendar picks may fall between weekly SE Ranking checks — allow a week.
  const current = pickCheckNearDate(checks, compareDate, 7);
  const baseline = pickCheckNearDate(checks, baselineDate, 7);
  const currentPos = current ? Number(current.pos) || 0 : 0;
  const baselinePos = baseline ? Number(baseline.pos) || 0 : null;
  let compareDelta = null;
  if (baselinePos != null && currentPos > 0 && baselinePos > 0) {
    compareDelta = baselinePos - currentPos;
  }
  return {
    ...row,
    position: currentPos || row.position || 0,
    compareDate: current ? String(current.date || compareDate) : compareDate || null,
    baselineDate: baseline
      ? String(baseline.date || baselineDate)
      : baselineDate || null,
    baselinePosition: baselinePos,
    compareDelta,
    // Keep legacy wowDelta in sync with active compare so existing UI keeps working.
    wowDelta: compareDelta,
    priorPosition: baselinePos,
    priorDate: baseline ? String(baseline.date || '') : null,
    date: current ? String(current.date || '') : row.date || '',
  };
}

export function summarizeCompareMoves(rows = []) {
  let improved = 0;
  let declined = 0;
  let flat = 0;
  let missing = 0;
  for (const row of rows) {
    const d = row?.compareDelta;
    if (d == null || !Number.isFinite(Number(d))) {
      missing += 1;
      continue;
    }
    if (d > 0) improved += 1;
    else if (d < 0) declined += 1;
    else flat += 1;
  }
  return { improved, declined, flat, missing };
}

export const COMPARE_PRESETS = [
  { id: 'wow', label: 'Week over week', checkpoint: '7days', days: -7 },
  { id: 'mom', label: 'Month over month', checkpoint: '30days', days: -30 },
  { id: 'qoq', label: '90 days ago', checkpoint: '90days', days: -90 },
  { id: 'yoy', label: '1 year ago', checkpoint: '180days', days: -365 },
  { id: 'start', label: 'vs range start', checkpoint: null, days: null },
];

/** Clamp a calendar YMD into [min, max] when bounds are present. */
export function clampYmd(ymdStr, minYmd = '', maxYmd = '') {
  let next = String(ymdStr || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) return '';
  if (minYmd && next < minYmd) next = minYmd;
  if (maxYmd && next > maxYmd) next = maxYmd;
  return next;
}

export function resolveComparePreset(
  presetId,
  { checkDates = [], checkpoints = {}, rangeFrom = '' } = {},
) {
  const dates = Array.isArray(checkDates) ? checkDates.filter(Boolean) : [];
  const compareDate =
    String(checkpoints.current || '').trim() ||
    (dates.length ? dates[dates.length - 1] : '');
  if (!compareDate) return { baselineDate: '', compareDate: '' };

  if (presetId === 'start') {
    const startTarget = rangeFrom || (dates.length ? dates[0] : '');
    const baseline =
      pickCheckNearDate(
        dates.map((date) => ({ date })),
        startTarget,
        5,
      )?.date ||
      dates[0] ||
      '';
    return { baselineDate: baseline, compareDate };
  }

  if (presetId === 'yoy') {
    const target = addDaysYmd(compareDate, -365);
    const fromFirst = String(checkpoints.first || '').trim();
    const baseline =
      pickCheckNearDate(
        dates.map((date) => ({ date })),
        target,
        14,
      )?.date ||
      (fromFirst && fromFirst <= target ? fromFirst : '') ||
      (dates.length ? dates[0] : '');
    return { baselineDate: baseline, compareDate };
  }

  const preset = COMPARE_PRESETS.find((p) => p.id === presetId);
  if (!preset) return defaultCompareDates(dates, checkpoints);

  const fromCheckpoint = preset.checkpoint
    ? String(checkpoints[preset.checkpoint] || '').trim()
    : '';
  const target = fromCheckpoint || addDaysYmd(compareDate, preset.days || -7);
  const baseline =
    pickCheckNearDate(
      dates.map((date) => ({ date })),
      target,
      5,
    )?.date ||
    fromCheckpoint ||
    '';
  return {
    baselineDate: baseline || defaultCompareDates(dates, checkpoints).baselineDate,
    compareDate,
  };
}

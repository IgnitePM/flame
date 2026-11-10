import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyKeywordDateCompare,
  clampYmd,
  defaultCompareDates,
  pickCheckNearDate,
  resolveComparePreset,
  summarizeCompareMoves,
  uniqueSortedCheckDates,
} from './keywordRankCompare.js';

describe('pickCheckNearDate', () => {
  it('picks closest check within window', () => {
    const checks = [
      { date: '2025-10-01', pos: 12 },
      { date: '2025-10-08', pos: 9 },
      { date: '2025-10-15', pos: 7 },
    ];
    assert.equal(pickCheckNearDate(checks, '2025-10-09').pos, 9);
    assert.equal(pickCheckNearDate(checks, '2025-11-01', 3), null);
  });
});

describe('defaultCompareDates', () => {
  it('uses checkpoints when present', () => {
    const r = defaultCompareDates(
      ['2025-10-01', '2025-10-08', '2025-10-15'],
      { current: '2025-10-15', '7days': '2025-10-08' },
    );
    assert.deepEqual(r, {
      baselineDate: '2025-10-08',
      compareDate: '2025-10-15',
    });
  });
});

describe('applyKeywordDateCompare', () => {
  it('computes positive delta when rank improves', () => {
    const row = applyKeywordDateCompare(
      {
        id: '1',
        name: 'seo',
        checks: [
          { date: '2025-10-01', pos: 20 },
          { date: '2025-10-15', pos: 8 },
        ],
      },
      '2025-10-01',
      '2025-10-15',
    );
    assert.equal(row.position, 8);
    assert.equal(row.baselinePosition, 20);
    assert.equal(row.compareDelta, 12);
  });
});

describe('uniqueSortedCheckDates / summarize / presets', () => {
  it('collects dates and summarizes moves', () => {
    const dates = uniqueSortedCheckDates([
      { checks: [{ date: '2025-10-15', pos: 1 }, { date: '2025-10-01', pos: 3 }] },
      { checks: [{ date: '2025-10-08', pos: 2 }] },
    ]);
    assert.deepEqual(dates, ['2025-10-01', '2025-10-08', '2025-10-15']);
    const rows = [
      { compareDelta: 2 },
      { compareDelta: -1 },
      { compareDelta: 0 },
      { compareDelta: null },
    ];
    assert.deepEqual(summarizeCompareMoves(rows), {
      improved: 1,
      declined: 1,
      flat: 1,
      missing: 1,
    });
  });

  it('resolves month preset from checkpoints', () => {
    const r = resolveComparePreset('mom', {
      checkDates: ['2025-09-15', '2025-10-15'],
      checkpoints: { current: '2025-10-15', '30days': '2025-09-15' },
    });
    assert.equal(r.compareDate, '2025-10-15');
    assert.equal(r.baselineDate, '2025-09-15');
  });

  it('clamps calendar dates into available history', () => {
    assert.equal(clampYmd('2025-01-01', '2025-09-02', '2025-11-10'), '2025-09-02');
    assert.equal(clampYmd('2025-12-01', '2025-09-02', '2025-11-10'), '2025-11-10');
    assert.equal(clampYmd('2025-10-05', '2025-09-02', '2025-11-10'), '2025-10-05');
  });
});

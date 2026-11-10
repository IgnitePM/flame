import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BILLING_TIME_ZONE,
  billingCycleStartAt,
  getBillingPeriod,
  isExactUtcMidnight,
  isLegacyUtcBillingCycleKey,
  isTorontoMidnightMs,
  nextBillingCycleStart,
  utcMidnightKeyToTorontoMidnightKey,
  zonedYmd,
} from './billingEngine.js';

describe('billingEngine America/Toronto cycle keys', () => {
  it('billingCycleStartAt is Toronto midnight (EDT in July)', () => {
    const start = billingCycleStartAt(1, 2025, 6); // July 1 2025
    assert.equal(new Date(start).toISOString(), '2025-07-01T04:00:00.000Z');
    assert.equal(isTorontoMidnightMs(start), true);
    assert.equal(isExactUtcMidnight(start), false);
  });

  it('billingCycleStartAt is Toronto midnight (EST in January)', () => {
    const start = billingCycleStartAt(1, 2025, 0); // Jan 1 2025
    assert.equal(new Date(start).toISOString(), '2025-01-01T05:00:00.000Z');
    assert.equal(isTorontoMidnightMs(start), true);
  });

  it('getBillingPeriod uses Toronto calendar day, not host TZ', () => {
    // 2025-11-15 15:00 UTC = still Nov 15 in Toronto
    const now = Date.UTC(2025, 10, 15, 15, 0, 0);
    const period = getBillingPeriod(1, 0, now);
    assert.equal(period.start, billingCycleStartAt(1, 2025, 10));
    assert.equal(isTorontoMidnightMs(period.start), true);
    assert.equal(
      nextBillingCycleStart(1, period.start) - 1,
      period.end,
    );
  });

  it('getBillingPeriod rolls back before the billing day (Toronto)', () => {
    // Nov 6 2025 18:00 UTC → Nov 6 afternoon Toronto; billingDay 15 → Oct 15 start
    const now = Date.UTC(2025, 10, 6, 18, 0, 0);
    const period = getBillingPeriod(15, 0, now);
    assert.equal(period.start, billingCycleStartAt(15, 2025, 9));
    const ymd = zonedYmd(BILLING_TIME_ZONE, period.start);
    assert.deepEqual(ymd, { year: 2025, month: 9, day: 15 });
  });

  it('maps legacy UTC midnight keys to Toronto midnight', () => {
    const utcKey = Date.UTC(2025, 10, 1); // Nov 1 2025 00:00Z
    assert.equal(isExactUtcMidnight(utcKey), true);
    assert.equal(isLegacyUtcBillingCycleKey(utcKey, 1), true);
    const toronto = utcMidnightKeyToTorontoMidnightKey(utcKey);
    assert.equal(toronto, billingCycleStartAt(1, 2025, 10));
    assert.equal(isLegacyUtcBillingCycleKey(toronto, 1), false);
    assert.equal(isTorontoMidnightMs(toronto), true);
  });

  it('does not treat unrelated UTC midnights as billing keys', () => {
    const utcKey = Date.UTC(2025, 10, 7); // Nov 7 — not billingDay 1
    assert.equal(isLegacyUtcBillingCycleKey(utcKey, 1), false);
    assert.equal(isLegacyUtcBillingCycleKey(utcKey, 7), true);
  });
});

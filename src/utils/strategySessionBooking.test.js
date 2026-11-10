import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_STRATEGY_BOOKING_URL,
  buildStrategyReminderMessageBody,
  resolveStrategyBookingUrl,
  strategyReminderMonthKey,
  torontoParts,
} from './strategySessionBooking.js';

describe('strategySessionBooking', () => {
  it('resolves booking URL from settings or default', () => {
    assert.equal(resolveStrategyBookingUrl({}), DEFAULT_STRATEGY_BOOKING_URL);
    assert.equal(
      resolveStrategyBookingUrl({
        strategySessionBookingUrl: 'https://example.com/book',
      }),
      'https://example.com/book',
    );
    assert.equal(
      resolveStrategyBookingUrl({ strategySessionBookingUrl: 'not-a-url' }),
      DEFAULT_STRATEGY_BOOKING_URL,
    );
  });

  it('builds a reminder body with portal + direct link guidance', () => {
    const body = buildStrategyReminderMessageBody({
      clientName: 'Twin Peaks',
      monthLabel: 'November 2026',
      bookingUrl: 'https://example.com/book',
    });
    assert.match(body, /Twin Peaks/);
    assert.match(body, /November 2026/);
    assert.match(body, /client portal/);
    assert.match(body, /https:\/\/example\.com\/book/);
  });

  it('formats Toronto month keys', () => {
    const fixed = new Date('2026-11-10T16:00:00Z');
    const parts = torontoParts(fixed);
    assert.equal(parts.year, 2026);
    assert.equal(parts.month, 11);
    assert.equal(strategyReminderMonthKey(fixed), '2026-11');
  });
});

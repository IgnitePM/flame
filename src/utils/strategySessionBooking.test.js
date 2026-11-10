import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_STRATEGY_BOOKING_URL,
  DEFAULT_STRATEGY_REMINDER_BODY,
  buildStrategyReminderMessageBody,
  buildStrategyReminderSubject,
  renderStrategyReminderTemplate,
  resolveStrategyBookingUrl,
  resolveStrategyReminderBodyTemplate,
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
      portalUrl: 'https://portal.example/?tab=dashboard',
    });
    assert.match(body, /Twin Peaks/);
    assert.match(body, /November 2026/);
    assert.match(body, /client portal/);
    assert.match(body, /https:\/\/example\.com\/book/);
    assert.match(body, /portal\.example/);
  });

  it('renders editable templates with personalization tokens', () => {
    const custom = 'Hello {{businessName}} — see you in {{monthName}} {{year}}!';
    assert.equal(
      renderStrategyReminderTemplate(custom, {
        businessName: 'Acme',
        monthName: 'November',
        year: '2026',
      }),
      'Hello Acme — see you in November 2026!',
    );
    const body = buildStrategyReminderMessageBody({
      settings: { strategySessionReminderBody: custom },
      clientName: 'Acme Co',
      monthLabel: 'November 2026',
      monthName: 'November',
      year: '2026',
    });
    assert.equal(body, 'Hello Acme Co — see you in November 2026!');
    assert.equal(
      buildStrategyReminderSubject({
        settings: {
          strategySessionReminderSubject:
            'Reminder for {{clientName}} ({{month}})',
        },
        clientName: 'Acme Co',
        monthLabel: 'November 2026',
      }),
      'Reminder for Acme Co (November 2026)',
    );
  });

  it('falls back to default body template when settings blank', () => {
    assert.equal(
      resolveStrategyReminderBodyTemplate({ strategySessionReminderBody: '  ' }),
      DEFAULT_STRATEGY_REMINDER_BODY,
    );
  });

  it('formats Toronto month keys', () => {
    const fixed = new Date('2026-11-10T16:00:00Z');
    const parts = torontoParts(fixed);
    assert.equal(parts.year, 2026);
    assert.equal(parts.month, 11);
    assert.equal(strategyReminderMonthKey(fixed), '2026-11');
  });
});

/**
 * Shared Strategy & Review booking link + month helpers for portal + reminders.
 */

export const DEFAULT_STRATEGY_BOOKING_URL =
  'https://calendar.google.com/calendar/appointments/schedules/AcZssZ3hxleqix4-22fqafu-IKH-TRuMH69LqNM57WAYgkxRgrqbkRQ-tWnT2zS-smPwZEIugx-6Xo9k';

export function torontoParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
  };
}

/** Cursor key like 2026-11 for once-per-month watermarking. */
export function strategyReminderMonthKey(now = new Date()) {
  const { year, month } = torontoParts(now);
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function strategyReminderMonthLabel(now = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Toronto',
    month: 'long',
    year: 'numeric',
  }).format(now);
}

export function isTorontoFirstOfMonth(now = new Date()) {
  return torontoParts(now).day === 1;
}

export function resolveStrategyBookingUrl(settings = {}) {
  const fromSettings = String(settings.strategySessionBookingUrl || '').trim();
  if (/^https:\/\//i.test(fromSettings)) return fromSettings;
  return DEFAULT_STRATEGY_BOOKING_URL;
}

export function buildStrategyReminderMessageBody({
  clientName = '',
  monthLabel = '',
  bookingUrl = DEFAULT_STRATEGY_BOOKING_URL,
} = {}) {
  const name = String(clientName || '').trim() || 'there';
  const month = String(monthLabel || '').trim() || 'this month';
  const url = String(bookingUrl || DEFAULT_STRATEGY_BOOKING_URL).trim();
  return [
    `Hi ${name},`,
    '',
    `A quick reminder to book your ${month} Strategy & Review session with Ignite.`,
    '',
    'The easiest place to book is inside your client portal on the Home page (Book meeting). You can also use this link directly:',
    url,
    '',
    'Looking forward to connecting.',
    '',
    '— Ignite PM',
  ].join('\n');
}

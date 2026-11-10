/**
 * Shared Strategy & Review booking link + editable reminder templates.
 *
 * Templates use {{token}} placeholders and are personalized per client at send time.
 */

export const DEFAULT_STRATEGY_BOOKING_URL =
  'https://calendar.google.com/calendar/appointments/schedules/AcZssZ3hxleqix4-22fqafu-IKH-TRuMH69LqNM57WAYgkxRgrqbkRQ-tWnT2zS-smPwZEIugx-6Xo9k';

export const DEFAULT_STRATEGY_AGENCY_NAME = 'Ignite PM';

/** Tokens available in subject + body editors. */
export const STRATEGY_REMINDER_TOKENS = [
  {
    token: 'clientName',
    label: 'Client / business name',
    example: 'Twin Peaks Property Inspections',
  },
  {
    token: 'businessName',
    label: 'Business name (same as client)',
    example: 'Twin Peaks Property Inspections',
  },
  {
    token: 'month',
    label: 'Month + year',
    example: 'November 2026',
  },
  {
    token: 'monthName',
    label: 'Month only',
    example: 'November',
  },
  {
    token: 'year',
    label: 'Year',
    example: '2026',
  },
  {
    token: 'bookingUrl',
    label: 'Direct Google booking link',
    example: DEFAULT_STRATEGY_BOOKING_URL,
  },
  {
    token: 'portalUrl',
    label: 'Client portal Home link',
    example: 'https://ignitetimetracker.netlify.app?tab=dashboard',
  },
  {
    token: 'agencyName',
    label: 'Your agency name',
    example: DEFAULT_STRATEGY_AGENCY_NAME,
  },
];

export const DEFAULT_STRATEGY_REMINDER_SUBJECT =
  'Book your {{month}} Strategy & Review session — {{businessName}}';

export const DEFAULT_STRATEGY_REMINDER_BODY = [
  'Hi {{businessName}},',
  '',
  'A quick reminder to book your {{month}} Strategy & Review session with {{agencyName}}.',
  '',
  'The easiest place to book is inside your client portal on the Home page (Book meeting):',
  '{{portalUrl}}',
  '',
  'You can also use this link directly:',
  '{{bookingUrl}}',
  '',
  'Looking forward to connecting.',
  '',
  '— {{agencyName}}',
].join('\n');

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

export function strategyReminderMonthName(now = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Toronto',
    month: 'long',
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

export function resolveStrategyAgencyName(settings = {}) {
  const name = String(settings.strategySessionAgencyName || '').trim();
  return name || DEFAULT_STRATEGY_AGENCY_NAME;
}

export function resolveStrategyReminderSubjectTemplate(settings = {}) {
  const raw = String(settings.strategySessionReminderSubject || '').trim();
  return raw || DEFAULT_STRATEGY_REMINDER_SUBJECT;
}

export function resolveStrategyReminderBodyTemplate(settings = {}) {
  const raw = String(settings.strategySessionReminderBody || '');
  // Allow intentionally blank? Prefer default when empty so sends stay useful.
  if (!String(raw).trim()) return DEFAULT_STRATEGY_REMINDER_BODY;
  return raw;
}

/**
 * Replace {{token}} and {token} placeholders. Unknown tokens stay as-is.
 */
export function renderStrategyReminderTemplate(template, vars = {}) {
  const source = String(template ?? '');
  const map = Object.fromEntries(
    Object.entries(vars || {}).map(([k, v]) => [
      String(k).toLowerCase(),
      v == null ? '' : String(v),
    ]),
  );
  return source.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}|\{([a-zA-Z0-9_]+)\}/g, (full, a, b) => {
    const key = String(a || b || '').toLowerCase();
    if (!key || !(key in map)) return full;
    return map[key];
  });
}

export function buildStrategyReminderVars({
  clientName = '',
  monthLabel = '',
  monthName = '',
  year = '',
  bookingUrl = DEFAULT_STRATEGY_BOOKING_URL,
  portalUrl = '',
  agencyName = DEFAULT_STRATEGY_AGENCY_NAME,
} = {}) {
  const business = String(clientName || '').trim() || 'there';
  const month = String(monthLabel || '').trim() || 'this month';
  return {
    clientName: business,
    businessName: business,
    month,
    monthName: String(monthName || '').trim() || month,
    year: String(year || '').trim(),
    bookingUrl: String(bookingUrl || DEFAULT_STRATEGY_BOOKING_URL).trim(),
    portalUrl: String(portalUrl || '').trim(),
    agencyName: String(agencyName || DEFAULT_STRATEGY_AGENCY_NAME).trim(),
  };
}

export function buildStrategyReminderMessageBody(opts = {}) {
  const settings = opts.settings || {};
  const template =
    opts.bodyTemplate || resolveStrategyReminderBodyTemplate(settings);
  const vars = buildStrategyReminderVars(opts);
  return renderStrategyReminderTemplate(template, vars);
}

export function buildStrategyReminderSubject(opts = {}) {
  const settings = opts.settings || {};
  const template =
    opts.subjectTemplate || resolveStrategyReminderSubjectTemplate(settings);
  const vars = buildStrategyReminderVars(opts);
  return renderStrategyReminderTemplate(template, vars).replace(/\s+/g, ' ').trim();
}

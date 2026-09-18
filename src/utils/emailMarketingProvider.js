/**
 * Per-client email marketing analytics provider.
 * Stored on clients/{id}.emailMarketingProvider
 */

export const EMAIL_MARKETING_PROVIDERS = [
  {
    id: 'mailchimp',
    label: 'Mailchimp',
    endpoint: '/.netlify/functions/portal-mailchimp',
  },
  {
    id: 'gohighlevel',
    label: 'GoHighLevel',
    endpoint: '/.netlify/functions/portal-gohighlevel',
  },
];

export function normalizeEmailMarketingProvider(raw) {
  const id = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  if (id === 'gohighlevel' || id === 'ghl' || id === 'highlevel') return 'gohighlevel';
  return 'mailchimp';
}

export function getEmailMarketingProviderMeta(raw) {
  const id = normalizeEmailMarketingProvider(raw);
  return (
    EMAIL_MARKETING_PROVIDERS.find((p) => p.id === id) || EMAIL_MARKETING_PROVIDERS[0]
  );
}

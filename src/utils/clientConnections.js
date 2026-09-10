import { normalizeExternalUrl } from './clientDocuments.js';

export function newPinnedDocId() {
  return `pin_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function normalizePinnedDoc(raw) {
  return {
    id: String(raw?.id || newPinnedDocId()),
    label: String(raw?.label || '').trim(),
    url: String(raw?.url || '').trim(),
  };
}

export function normalizePinnedDocs(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizePinnedDoc)
    .filter((d) => d.url)
    .slice(0, 20);
}

/** Fields stored on the client doc for external service deep links. */
export function normalizeClientConnectionFields(client = {}) {
  return {
    googleDriveFolderUrl: String(client.googleDriveFolderUrl || '').trim(),
    hubspotProfileUrl: String(client.hubspotProfileUrl || '').trim(),
    slackChannelUrl: String(client.slackChannelUrl || '').trim(),
    /** Optional incoming webhook for this client's Slack channel (Phase 3 posts). */
    slackWebhookUrl: String(client.slackWebhookUrl || '').trim(),
    googleCalendarUrl: String(client.googleCalendarUrl || '').trim(),
    perplexityUrl: String(client.perplexityUrl || '').trim(),
    googleBusinessProfileUrl: String(client.googleBusinessProfileUrl || '').trim(),
    linkedinUrl: String(client.linkedinUrl || '').trim(),
    facebookUrl: String(client.facebookUrl || '').trim(),
    instagramUrl: String(client.instagramUrl || '').trim(),
    twitterUrl: String(client.twitterUrl || '').trim(),
    pinnedDocs: normalizePinnedDocs(client.pinnedDocs),
  };
}

export function clientConnectionLinks(client) {
  const c = normalizeClientConnectionFields(client || {});
  const links = [
    { key: 'website', label: 'Website', href: normalizeExternalUrl(client?.website) },
    {
      key: 'gmb',
      label: 'Google Business',
      href: normalizeExternalUrl(c.googleBusinessProfileUrl),
    },
    { key: 'linkedin', label: 'LinkedIn', href: normalizeExternalUrl(c.linkedinUrl) },
    { key: 'facebook', label: 'Facebook', href: normalizeExternalUrl(c.facebookUrl) },
    { key: 'instagram', label: 'Instagram', href: normalizeExternalUrl(c.instagramUrl) },
    { key: 'twitter', label: 'X', href: normalizeExternalUrl(c.twitterUrl) },
    { key: 'drive', label: 'Google Drive', href: normalizeExternalUrl(c.googleDriveFolderUrl) },
    { key: 'hubspot', label: 'HubSpot', href: normalizeExternalUrl(c.hubspotProfileUrl) },
    { key: 'slack', label: 'Slack', href: normalizeExternalUrl(c.slackChannelUrl) },
    { key: 'calendar', label: 'Calendar', href: normalizeExternalUrl(c.googleCalendarUrl) },
    { key: 'perplexity', label: 'Perplexity', href: normalizeExternalUrl(c.perplexityUrl) },
  ];
  for (const doc of c.pinnedDocs) {
    links.push({
      key: `doc_${doc.id}`,
      label: doc.label || 'Doc',
      href: normalizeExternalUrl(doc.url),
    });
  }
  return links.filter((l) => l.href);
}

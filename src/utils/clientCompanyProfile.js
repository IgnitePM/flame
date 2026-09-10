/**
 * Normalize company profile fields stored on clients/{id} (HubSpot-style enrichment).
 */

export function emptyCompanyProfile() {
  return {
    companyDescription: '',
    industry: '',
    address: '',
    city: '',
    region: '',
    postalCode: '',
    country: '',
    googleBusinessProfileUrl: '',
    linkedinUrl: '',
    facebookUrl: '',
    instagramUrl: '',
    twitterUrl: '',
  };
}

export function normalizeCompanyProfileFields(client = {}) {
  const e = emptyCompanyProfile();
  return {
    companyDescription: String(client.companyDescription ?? e.companyDescription).trim(),
    industry: String(client.industry ?? e.industry).trim(),
    address: String(client.address ?? e.address).trim(),
    city: String(client.city ?? e.city).trim(),
    region: String(client.region ?? e.region).trim(),
    postalCode: String(client.postalCode ?? e.postalCode).trim(),
    country: String(client.country ?? e.country).trim(),
    googleBusinessProfileUrl: String(
      client.googleBusinessProfileUrl ?? e.googleBusinessProfileUrl,
    ).trim(),
    linkedinUrl: String(client.linkedinUrl ?? e.linkedinUrl).trim(),
    facebookUrl: String(client.facebookUrl ?? e.facebookUrl).trim(),
    instagramUrl: String(client.instagramUrl ?? e.instagramUrl).trim(),
    twitterUrl: String(client.twitterUrl ?? e.twitterUrl).trim(),
  };
}

/** Format a one-line address for display. */
export function formatCompanyAddress(client = {}) {
  const p = normalizeCompanyProfileFields(client);
  return [p.address, p.city, p.region, p.postalCode, p.country].filter(Boolean).join(', ');
}

/**
 * Merge enrichment suggestions into a client draft.
 * By default only fills empty fields (HubSpot-style); set overwrite=true to replace.
 */
export function applyCompanyEnrichment(client, suggestion, { overwrite = false } = {}) {
  const cur = client && typeof client === 'object' ? { ...client } : {};
  const s = suggestion && typeof suggestion === 'object' ? suggestion : {};
  const fill = (key, value) => {
    const next = String(value ?? '').trim();
    if (!next) return;
    const prev = String(cur[key] ?? '').trim();
    if (overwrite || !prev) cur[key] = next;
  };

  fill('website', s.website);
  fill('phone', s.phone);
  fill('companyDescription', s.companyDescription);
  fill('industry', s.industry);
  fill('address', s.address);
  fill('city', s.city);
  fill('region', s.region);
  fill('postalCode', s.postalCode);
  fill('country', s.country);
  fill('googleBusinessProfileUrl', s.googleBusinessProfileUrl);
  fill('linkedinUrl', s.linkedinUrl);
  fill('facebookUrl', s.facebookUrl);
  fill('instagramUrl', s.instagramUrl);
  fill('twitterUrl', s.twitterUrl);

  if (s.name && (overwrite || !String(cur.name || '').trim())) {
    // Name is usually set already; only fill if blank (rare for existing clients).
    cur.name = String(s.name).trim();
  }

  const pcIn = s.primaryContact && typeof s.primaryContact === 'object' ? s.primaryContact : null;
  if (pcIn) {
    const prev = cur.primaryContact && typeof cur.primaryContact === 'object' ? cur.primaryContact : {};
    cur.primaryContact = {
      name: overwrite || !String(prev.name || '').trim() ? String(pcIn.name || prev.name || '').trim() : prev.name,
      email:
        overwrite || !String(prev.email || '').trim()
          ? String(pcIn.email || prev.email || '').trim()
          : prev.email,
      phone:
        overwrite || !String(prev.phone || '').trim()
          ? String(pcIn.phone || prev.phone || '').trim()
          : prev.phone,
      title:
        overwrite || !String(prev.title || '').trim()
          ? String(pcIn.title || prev.title || '').trim()
          : prev.title,
    };
  }

  return cur;
}

/** Human labels for enrichment preview. */
export const COMPANY_ENRICH_FIELD_LABELS = {
  name: 'Company name',
  website: 'Website',
  phone: 'Phone',
  companyDescription: 'About',
  industry: 'Industry',
  address: 'Street address',
  city: 'City',
  region: 'State / province',
  postalCode: 'Postal code',
  country: 'Country',
  googleBusinessProfileUrl: 'Google Business Profile',
  linkedinUrl: 'LinkedIn',
  facebookUrl: 'Facebook',
  instagramUrl: 'Instagram',
  twitterUrl: 'X / Twitter',
  'primaryContact.name': 'Primary contact name',
  'primaryContact.email': 'Primary contact email',
  'primaryContact.phone': 'Primary contact phone',
  'primaryContact.title': 'Primary contact title',
};

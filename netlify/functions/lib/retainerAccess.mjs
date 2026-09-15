/**
 * Server-side retainer gating for portal analytics proxies.
 * Mirrors src/utils/retainerCategories.js helpers (keep in sync).
 */

function enabledCategoryNames(client) {
  const retainers =
    client?.retainers && typeof client.retainers === 'object' ? client.retainers : {};
  const flags =
    client?.retainerCategoryEnabled && typeof client.retainerCategoryEnabled === 'object'
      ? client.retainerCategoryEnabled
      : {};
  const names = [...new Set([...Object.keys(retainers), ...Object.keys(flags)])];
  return names.filter((name) => {
    if (flags[name] === false) return false;
    if (flags[name] === true) return true;
    return Number(retainers[name] || 0) > 0;
  });
}

export function clientHasActiveSeoRetainer(client) {
  return enabledCategoryNames(client).some((name) =>
    String(name || '')
      .toLowerCase()
      .includes('seo'),
  );
}

export function clientHasActiveEmailRetainer(client) {
  return enabledCategoryNames(client).some((name) =>
    String(name || '')
      .toLowerCase()
      .includes('email'),
  );
}

export function clientHasActiveSocialMediaRetainer(client) {
  return enabledCategoryNames(client).some((name) =>
    String(name || '')
      .toLowerCase()
      .includes('social media'),
  );
}

export function clientHasActiveAdsRetainer(client) {
  return enabledCategoryNames(client).some((name) => {
    const lower = String(name || '').toLowerCase().trim();
    if (lower === 'social ad budget') return true;
    if (/\bgoogle\s*ads\b/.test(lower)) return true;
    if (/\bppc\b/.test(lower)) return true;
    if (/\bads?\b/.test(lower) && !lower.includes('social media')) return true;
    return false;
  });
}

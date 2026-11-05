import { timingSafeEqual } from 'node:crypto';

/**
 * API-key auth for the Perplexity MCP connector (staff-only, server-to-server).
 * Accepts Authorization: Bearer <key> or X-Api-Key: <key>.
 */

function readHeader(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') {
    return String(headers.get(name) || headers.get(name.toLowerCase()) || '');
  }
  return String(headers[name] || headers[name.toLowerCase()] || '');
}

export function extractMcpApiKey(headers) {
  const auth = readHeader(headers, 'authorization').trim();
  if (/^bearer\s+/i.test(auth)) {
    return auth.replace(/^bearer\s+/i, '').trim();
  }
  const xKey = readHeader(headers, 'x-api-key').trim();
  if (xKey) return xKey;
  return '';
}

export function configuredMcpApiKey() {
  return String(process.env.PERPLEXITY_MCP_API_KEY || '').trim();
}

export function mcpApiKeyConfigured() {
  return configuredMcpApiKey().length >= 24;
}

/** Constant-time compare; rejects empty / misconfigured keys. */
export function verifyMcpApiKey(headers) {
  const expected = configuredMcpApiKey();
  const provided = extractMcpApiKey(headers);
  if (!expected || expected.length < 24) {
    return { ok: false, status: 503, error: 'MCP API key is not configured on the server.' };
  }
  if (!provided || provided.length !== expected.length) {
    return { ok: false, status: 401, error: 'Unauthorized.' };
  }
  try {
    const a = Buffer.from(provided, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, status: 401, error: 'Unauthorized.' };
    }
  } catch {
    return { ok: false, status: 401, error: 'Unauthorized.' };
  }
  return { ok: true };
}

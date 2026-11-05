import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractMcpApiKey,
  verifyMcpApiKey,
} from './mcpAuth.mjs';

function headers(map) {
  return {
    get(name) {
      const key = String(name || '').toLowerCase();
      for (const [k, v] of Object.entries(map)) {
        if (String(k).toLowerCase() === key) return v;
      }
      return null;
    },
  };
}

describe('extractMcpApiKey', () => {
  it('reads Bearer and X-Api-Key', () => {
    assert.equal(
      extractMcpApiKey(headers({ Authorization: 'Bearer secret-key-value' })),
      'secret-key-value',
    );
    assert.equal(
      extractMcpApiKey(headers({ 'X-Api-Key': 'other-key' })),
      'other-key',
    );
  });
});

describe('verifyMcpApiKey', () => {
  it('rejects when env key missing or too short', () => {
    const prev = process.env.PERPLEXITY_MCP_API_KEY;
    process.env.PERPLEXITY_MCP_API_KEY = 'short';
    const res = verifyMcpApiKey(headers({ Authorization: 'Bearer short' }));
    assert.equal(res.ok, false);
    assert.equal(res.status, 503);
    process.env.PERPLEXITY_MCP_API_KEY = prev;
  });

  it('accepts a matching long key', () => {
    const prev = process.env.PERPLEXITY_MCP_API_KEY;
    const key = 'abcdefghijklmnopqrstuvwxyz012345';
    process.env.PERPLEXITY_MCP_API_KEY = key;
    const ok = verifyMcpApiKey(headers({ Authorization: `Bearer ${key}` }));
    assert.equal(ok.ok, true);
    const bad = verifyMcpApiKey(
      headers({ Authorization: 'Bearer abcdefghijklmnopqrstuvwxyz01234X' }),
    );
    assert.equal(bad.ok, false);
    assert.equal(bad.status, 401);
    process.env.PERPLEXITY_MCP_API_KEY = prev;
  });
});

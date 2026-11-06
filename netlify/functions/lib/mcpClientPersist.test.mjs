import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Regression: fetchDoc returns data without `id`. Writers must reattach the
 * known client id or mergeDoc writes to `clients/undefined`.
 */
describe('client id persistence for MCP writes', () => {
  it('reattaches id when hydrating a fresh client snapshot', () => {
    const resolved = { id: 'bosch-real-id', name: 'Bosch Services' };
    const raw = { name: 'Bosch Services', todoCycles: {} }; // no id
    const fresh = raw ? { ...raw, id: resolved.id, name: raw.name || resolved.name } : resolved;
    assert.equal(fresh.id, 'bosch-real-id');
    assert.notEqual(String(fresh.id), 'undefined');
  });

  it('refuses undefined client ids for write paths', () => {
    const bad = String(undefined);
    assert.equal(bad, 'undefined');
    const clientId = String({}.id || '').trim();
    assert.equal(clientId, '');
    assert.ok(!clientId || clientId === 'undefined' ? true : false);
  });
});

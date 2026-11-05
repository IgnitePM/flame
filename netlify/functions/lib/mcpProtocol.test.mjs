import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  dispatchMcpJsonRpc,
  handleInitialize,
  listMcpTools,
} from './mcpProtocol.mjs';

describe('handleInitialize', () => {
  it('returns tools capability and server info', () => {
    const result = handleInitialize({ protocolVersion: '2025-03-26' });
    assert.equal(result.protocolVersion, '2025-03-26');
    assert.ok(result.capabilities.tools);
    assert.equal(result.serverInfo.name, 'ignite-flame');
  });
});

describe('listMcpTools', () => {
  it('exposes the read-only tool set', () => {
    const { tools } = listMcpTools();
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      'get_client',
      'get_client_notes',
      'get_retainer_usage',
      'list_open_todos',
      'search_clients',
    ]);
    for (const t of tools) {
      assert.equal(t.annotations.readOnlyHint, true);
    }
  });
});

describe('dispatchMcpJsonRpc', () => {
  it('handles notifications with 202', async () => {
    const res = await dispatchMcpJsonRpc({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
    assert.equal(res.status, 202);
  });

  it('lists tools without Firestore', async () => {
    const res = await dispatchMcpJsonRpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.result.tools.length, 5);
  });

  it('returns tool error for unknown tool', async () => {
    const res = await dispatchMcpJsonRpc({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'drop_database', arguments: {} },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.result.isError, true);
  });
});

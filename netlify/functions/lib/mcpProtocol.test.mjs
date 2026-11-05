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
    assert.match(result.instructions, /create_todo/i);
  });
});

describe('listMcpTools', () => {
  it('exposes read + write tools', () => {
    const { tools } = listMcpTools();
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      'create_client_note',
      'create_todo',
      'get_client',
      'get_client_notes',
      'get_retainer_usage',
      'list_open_todos',
      'search_clients',
    ]);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    assert.equal(byName.search_clients.annotations.readOnlyHint, true);
    assert.equal(byName.create_todo.annotations.readOnlyHint, false);
    assert.equal(byName.create_client_note.annotations.readOnlyHint, false);
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
    assert.equal(res.body.result.tools.length, 7);
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

  it('requires category for create_todo before Firestore write', async () => {
    const res = await dispatchMcpJsonRpc({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'create_todo',
        arguments: { clientId: 'missing', text: 'Do thing' },
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.result.isError, true);
    assert.match(res.body.result.content[0].text, /category/i);
  });
});

/**
 * Stateless MCP JSON-RPC (Streamable HTTP) — tools only, read-only.
 */

export const MCP_SERVER_INFO = {
  name: 'ignite-flame',
  version: '1.0.0',
};

export const MCP_INSTRUCTIONS = [
  'Ignite Flame CRM — staff-only, read-only access to clients, retainers, todos, and internal notes.',
  'Prefer search_clients before get_client when you only have a partial name.',
  'Use get_client_notes for staff internal notes (not visible in the client portal).',
  'Never invent client IDs; use search/get results.',
].join(' ');

const TOOLS = [
  {
    name: 'search_clients',
    description:
      'Search active clients by name, website, or portal email. Returns compact summaries (id, retainers, open todo count).',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Name fragment, website, email, or empty for a short list',
        },
        limit: {
          type: 'number',
          description: 'Max results (1–25, default 10)',
        },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'get_client',
    description:
      'Get one client by id or exact/unique name. Returns profile, retainers, portal emails, Drive/Perplexity links.',
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'string', description: 'Firestore client document id' },
        name: { type: 'string', description: 'Client display name' },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'get_client_notes',
    description:
      'Staff-only internal notes for a client (generalNotes + per-cycle notes). Not shown in the client portal.',
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'string', description: 'Firestore client document id' },
        name: { type: 'string', description: 'Client name if id unknown' },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'list_open_todos',
    description:
      'Open retainer/project tasks for a client across billing cycles (current cycle first), including recent task comments.',
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'string' },
        name: { type: 'string' },
        limit: { type: 'number', description: 'Max todos (default 40)' },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'get_retainer_usage',
    description:
      'Current billing-cycle retainer allotment vs used hours/dollars by category for one client.',
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'string' },
        name: { type: 'string' },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
];

function textResult(payload, isError = false) {
  const text =
    typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  return {
    content: [{ type: 'text', text }],
    structuredContent: typeof payload === 'string' ? undefined : payload,
    isError: !!isError,
  };
}

export function listMcpTools() {
  return { tools: TOOLS };
}

async function requireClient(args = {}) {
  const { resolveClient } = await import('./mcpClientKnowledge.mjs');
  const client = await resolveClient({
    clientId: args.clientId,
    name: args.name,
  });
  if (!client) {
    const err = new Error('Client not found. Try search_clients.');
    err.code = 'not_found';
    throw err;
  }
  return client;
}

export async function callMcpTool(name, args = {}) {
  const tool = String(name || '').trim();
  const known = new Set(TOOLS.map((t) => t.name));
  if (!known.has(tool)) {
    const err = new Error(`Unknown tool: ${tool}`);
    err.code = 'unknown_tool';
    throw err;
  }

  const knowledge = await import('./mcpClientKnowledge.mjs');

  switch (tool) {
    case 'search_clients': {
      const results = await knowledge.searchClients(args.query, args.limit);
      return textResult({ count: results.length, clients: results });
    }
    case 'get_client': {
      const client = await requireClient(args);
      return textResult(knowledge.sanitizeClientSummary(client));
    }
    case 'get_client_notes': {
      const client = await requireClient(args);
      const notes = await knowledge.getClientNotes(client.id);
      return textResult({
        clientId: client.id,
        clientName: client.name,
        ...notes,
      });
    }
    case 'list_open_todos': {
      const client = await requireClient(args);
      const data = await knowledge.listOpenTodos(client, args.limit);
      return textResult({
        clientId: client.id,
        clientName: client.name,
        ...data,
      });
    }
    case 'get_retainer_usage': {
      const client = await requireClient(args);
      const usage = await knowledge.getRetainerUsage(client);
      return textResult(usage);
    }
    default: {
      const err = new Error(`Unknown tool: ${tool}`);
      err.code = 'unknown_tool';
      throw err;
    }
  }
}

export function handleInitialize(params = {}) {
  const requested = String(params.protocolVersion || '2025-03-26');
  const supported = ['2025-03-26', '2025-06-18', '2024-11-05'];
  const protocolVersion = supported.includes(requested)
    ? requested
    : '2025-03-26';
  return {
    protocolVersion,
    capabilities: {
      tools: {},
    },
    serverInfo: MCP_SERVER_INFO,
    instructions: MCP_INSTRUCTIONS,
  };
}

export async function dispatchMcpJsonRpc(message) {
  if (!message || typeof message !== 'object') {
    return {
      status: 400,
      body: {
        jsonrpc: '2.0',
        error: { code: -32700, message: 'Parse error' },
        id: null,
      },
    };
  }

  const { id, method, params } = message;
  const isNotification = id === undefined || id === null;

  if (!method || typeof method !== 'string') {
    return {
      status: 400,
      body: {
        jsonrpc: '2.0',
        error: { code: -32600, message: 'Invalid Request' },
        id: id ?? null,
      },
    };
  }

  // Notifications — accept and acknowledge.
  if (method === 'notifications/initialized' || method.startsWith('notifications/')) {
    return { status: 202, body: null };
  }

  try {
    if (method === 'initialize') {
      return {
        status: 200,
        body: {
          jsonrpc: '2.0',
          id,
          result: handleInitialize(params || {}),
        },
      };
    }
    if (method === 'ping') {
      return { status: 200, body: { jsonrpc: '2.0', id, result: {} } };
    }
    if (method === 'tools/list') {
      return {
        status: 200,
        body: { jsonrpc: '2.0', id, result: listMcpTools() },
      };
    }
    if (method === 'tools/call') {
      const name = params?.name;
      const args = params?.arguments || {};
      const result = await callMcpTool(name, args);
      return { status: 200, body: { jsonrpc: '2.0', id, result } };
    }

    if (isNotification) {
      return { status: 202, body: null };
    }
    return {
      status: 200,
      body: {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      },
    };
  } catch (err) {
    const messageText = err?.message || 'Tool failed';
    if (method === 'tools/call') {
      return {
        status: 200,
        body: {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: messageText }],
            isError: true,
          },
        },
      };
    }
    return {
      status: 200,
      body: {
        jsonrpc: '2.0',
        id: id ?? null,
        error: { code: -32000, message: messageText },
      },
    };
  }
}

/**
 * Stateless MCP JSON-RPC (Streamable HTTP) — tools for staff CRM access.
 */

export const MCP_SERVER_INFO = {
  name: 'ignite-flame',
  version: '1.3.0',
};

export const MCP_INSTRUCTIONS = [
  'Ignite Flame CRM — staff-only access to clients, retainers, todos, notes, time, expenses, and document links.',
  'Prefer search_clients before get_client when you only have a partial name.',
  'Use get_client_notes / create_client_note for staff internal notes (not in the client portal).',
  'Use create_todo (optional subtasks + dueDate) and add_subtask / update_todo_due_date for task planning from conversations.',
  'Use add_todo_comment to leave a note on a task. Use complete_todo to mark a task (or subtask via subtaskId) done; pass done=false to reopen.',
  'Parents with open subtasks cannot be completed until subtasks are done.',
  'Use log_time for completed manual time entries (max 12h). Use log_expense for CAD/USD costs. Use log_perplexity_credits for Computer credit usage (stored as expenses).',
  'Use link_document to attach a Drive file id/URL or bookmark a URL on the client (no raw file upload).',
  'Retainer category is required for time/expense/create_todo writes — match an enabled category from get_client.',
  'Never invent client IDs; never delete data.',
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
  {
    name: 'create_client_note',
    description:
      'Create or update a staff-only internal note for a client (not visible in the client portal). Defaults to appending to general notes. Use scope=cycle with a retainer category for cycle notes.',
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'string' },
        name: { type: 'string', description: 'Client name if id unknown' },
        text: { type: 'string', description: 'Note body to write' },
        scope: {
          type: 'string',
          description: '"general" (default) or "cycle"',
        },
        mode: {
          type: 'string',
          description: '"append" (default) or "replace"',
        },
        category: {
          type: 'string',
          description: 'Retainer category label (required when scope=cycle)',
        },
        categoryKey: {
          type: 'string',
          description: 'Retainer category key (alternative to category)',
        },
        cycleStart: {
          type: 'number',
          description: 'Billing cycle start ms (defaults to current cycle)',
        },
        actorEmail: {
          type: 'string',
          description: 'Optional attribution email for activity log',
        },
      },
      required: ['text'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: false,
    },
  },
  {
    name: 'create_todo',
    description:
      'Create an open staff task on a client’s current (or specified) billing cycle under an enabled retainer category. Not a portal request — appears immediately as a normal CRM task.',
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'string' },
        name: { type: 'string', description: 'Client name if id unknown' },
        text: { type: 'string', description: 'Task title/body' },
        category: {
          type: 'string',
          description: 'Enabled retainer category label (e.g. SEO)',
        },
        categoryKey: {
          type: 'string',
          description: 'Category key if label unknown',
        },
        cycleStart: {
          type: 'number',
          description: 'Billing cycle start ms (defaults to current)',
        },
        assigneeEmails: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional staff emails to assign',
        },
        dueDate: {
          type: 'string',
          description: 'Optional due date (ISO string or ms)',
        },
        estimatedHours: {
          type: 'number',
          description: 'Optional estimate in hours',
        },
        pinned: {
          type: 'boolean',
          description: 'Pin the task (default false)',
        },
        subtasks: {
          type: 'array',
          description:
            'Optional subtasks to create with the parent (each: text, dueDate?, assigneeEmails?)',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              dueDate: { type: 'string' },
              assigneeEmails: { type: 'array', items: { type: 'string' } },
              estimatedHours: { type: 'number' },
            },
          },
        },
        actorEmail: {
          type: 'string',
          description: 'Optional attribution email for activity log',
        },
      },
      required: ['text'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: false,
    },
  },
  {
    name: 'add_subtask',
    description:
      'Add a subtask (with optional due date) under an existing open todo.',
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'string' },
        name: { type: 'string' },
        todoId: { type: 'string', description: 'Parent task id' },
        text: { type: 'string' },
        dueDate: { type: 'string' },
        assigneeEmails: { type: 'array', items: { type: 'string' } },
        estimatedHours: { type: 'number' },
        categoryKey: { type: 'string' },
        cycleStart: { type: 'number' },
        actorEmail: { type: 'string' },
      },
      required: ['todoId', 'text'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: false,
    },
  },
  {
    name: 'update_todo_due_date',
    description:
      'Set or clear a todo due date (subtask dues are clamped if the parent moves earlier).',
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'string' },
        name: { type: 'string' },
        todoId: { type: 'string' },
        dueDate: {
          type: 'string',
          description: 'ISO date/ms, or null/"clear" to remove',
        },
        categoryKey: { type: 'string' },
        cycleStart: { type: 'number' },
        actorEmail: { type: 'string' },
      },
      required: ['todoId'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: false,
    },
  },
  {
    name: 'log_time',
    description:
      'Log completed manual time against a client retainer category (creates timesheet + taskLog). Max 12 hours per entry.',
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'string' },
        name: { type: 'string' },
        category: { type: 'string' },
        categoryKey: { type: 'string' },
        hours: { type: 'number' },
        minutes: { type: 'number' },
        durationMinutes: { type: 'number' },
        startTime: { type: 'string', description: 'ISO start (optional)' },
        endTime: { type: 'string', description: 'ISO end (optional)' },
        date: { type: 'string', description: 'Work date / start if startTime omitted' },
        notes: { type: 'string' },
        employeeName: { type: 'string' },
        actorEmail: { type: 'string' },
      },
      required: [],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: false,
    },
  },
  {
    name: 'log_expense',
    description:
      'Log a client expense against a retainer category (CAD by default; optional USD/EUR/GBP). Applies 1.3 markup for hour categories unless applyMarkup=false.',
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'string' },
        name: { type: 'string' },
        category: { type: 'string' },
        categoryKey: { type: 'string' },
        amount: { type: 'number' },
        currency: { type: 'string', description: 'CAD (default), USD, EUR, GBP' },
        description: { type: 'string' },
        date: { type: 'string' },
        applyMarkup: { type: 'boolean' },
        credits: {
          type: 'number',
          description: 'If set instead of amount, logs as Perplexity credits',
        },
        actorEmail: { type: 'string' },
      },
      required: [],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: false,
    },
  },
  {
    name: 'log_perplexity_credits',
    description:
      'Log Perplexity Computer credits used on a client (1 credit = $0.01 USD → CAD + markup). Stored as an expense with originalCurrency PERPLEXITY_CREDITS.',
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'string' },
        name: { type: 'string' },
        category: { type: 'string' },
        categoryKey: { type: 'string' },
        credits: { type: 'number', description: 'Number of Computer credits used' },
        description: { type: 'string' },
        date: { type: 'string' },
        applyMarkup: { type: 'boolean' },
        actorEmail: { type: 'string' },
      },
      required: ['credits'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: false,
    },
  },
  {
    name: 'link_document',
    description:
      'Link a Google Drive file (id or URL) or arbitrary document URL onto a client (and optionally a todo). Does not upload file bytes — paste a Drive link from the conversation.',
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'string' },
        name: { type: 'string' },
        url: { type: 'string' },
        driveFileId: { type: 'string' },
        label: {
          type: 'string',
          description: 'Document display name (not the client name)',
        },
        fileName: { type: 'string', description: 'Alias for label' },
        mimeType: { type: 'string' },
        sizeBytes: { type: 'number' },
        todoId: { type: 'string', description: 'Optional task to attach to' },
        categoryKey: { type: 'string' },
        cycleStart: { type: 'number' },
        actorEmail: { type: 'string' },
      },
      required: [],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: false,
    },
  },
  {
    name: 'add_todo_comment',
    description:
      'Add a staff comment/note on an existing task (synced across billing cycles for the same task id).',
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'string' },
        name: { type: 'string' },
        todoId: { type: 'string', description: 'Task id from list_open_todos' },
        text: { type: 'string', description: 'Comment body' },
        categoryKey: { type: 'string' },
        cycleStart: { type: 'number' },
        authorName: { type: 'string' },
        actorEmail: { type: 'string' },
      },
      required: ['todoId', 'text'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: false,
    },
  },
  {
    name: 'complete_todo',
    description:
      'Mark a primary task complete across cycles (or reopen with done=false). Pass subtaskId to complete/reopen a single subtask. Primary complete requires all subtasks done.',
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'string' },
        name: { type: 'string' },
        todoId: { type: 'string' },
        done: {
          type: 'boolean',
          description: 'true (default) to complete, false to reopen',
        },
        uncomplete: {
          type: 'boolean',
          description: 'Alias for done=false',
        },
        subtaskId: {
          type: 'string',
          description: 'If set, toggle only this subtask',
        },
        categoryKey: { type: 'string' },
        cycleStart: { type: 'number' },
        actorEmail: { type: 'string' },
      },
      required: ['todoId'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: false,
    },
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

  const needsCategory = new Set([
    'create_todo',
    'log_time',
    'log_expense',
    'log_perplexity_credits',
  ]);
  if (needsCategory.has(tool) && !args.category && !args.categoryKey) {
    const err = new Error(
      'category or categoryKey is required. Use get_client / get_retainer_usage for enabled categories.',
    );
    err.code = 'bad_request';
    throw err;
  }
  if (tool === 'create_client_note' && !String(args.text || '').trim()) {
    const err = new Error('text is required for create_client_note.');
    err.code = 'bad_request';
    throw err;
  }
  if (tool === 'add_subtask' && (!args.todoId || !String(args.text || '').trim())) {
    const err = new Error('todoId and text are required for add_subtask.');
    err.code = 'bad_request';
    throw err;
  }
  if (
    tool === 'add_todo_comment' &&
    (!args.todoId || !String(args.text || '').trim())
  ) {
    const err = new Error('todoId and text are required for add_todo_comment.');
    err.code = 'bad_request';
    throw err;
  }
  if (tool === 'complete_todo' && !args.todoId) {
    const err = new Error('todoId is required for complete_todo.');
    err.code = 'bad_request';
    throw err;
  }
  if (tool === 'update_todo_due_date' && !args.todoId) {
    const err = new Error('todoId is required for update_todo_due_date.');
    err.code = 'bad_request';
    throw err;
  }
  if (
    tool === 'link_document' &&
    !String(args.url || '').trim() &&
    !String(args.driveFileId || '').trim()
  ) {
    const err = new Error('url or driveFileId is required for link_document.');
    err.code = 'bad_request';
    throw err;
  }
  if (tool === 'log_perplexity_credits' && !(Number(args.credits) > 0)) {
    const err = new Error('credits must be a positive number.');
    err.code = 'bad_request';
    throw err;
  }
  if (
    tool === 'log_expense' &&
    !(Number(args.amount) > 0) &&
    !(Number(args.credits) > 0)
  ) {
    const err = new Error('amount or credits is required for log_expense.');
    err.code = 'bad_request';
    throw err;
  }

  switch (tool) {
    case 'search_clients': {
      const knowledge = await import('./mcpClientKnowledge.mjs');
      const results = await knowledge.searchClients(args.query, args.limit);
      return textResult({ count: results.length, clients: results });
    }
    case 'get_client': {
      const knowledge = await import('./mcpClientKnowledge.mjs');
      const client = await requireClient(args);
      return textResult(knowledge.sanitizeClientSummary(client));
    }
    case 'get_client_notes': {
      const knowledge = await import('./mcpClientKnowledge.mjs');
      const client = await requireClient(args);
      const notes = await knowledge.getClientNotes(client.id);
      return textResult({
        clientId: client.id,
        clientName: client.name,
        ...notes,
      });
    }
    case 'list_open_todos': {
      const knowledge = await import('./mcpClientKnowledge.mjs');
      const client = await requireClient(args);
      const data = await knowledge.listOpenTodos(client, args.limit);
      return textResult({
        clientId: client.id,
        clientName: client.name,
        ...data,
      });
    }
    case 'get_retainer_usage': {
      const knowledge = await import('./mcpClientKnowledge.mjs');
      const client = await requireClient(args);
      const usage = await knowledge.getRetainerUsage(client);
      return textResult(usage);
    }
    case 'create_client_note': {
      const client = await requireClient(args);
      const writes = await import('./mcpClientWrites.mjs');
      const result = await writes.createClientNote(client, args);
      return textResult(result);
    }
    case 'create_todo': {
      const client = await requireClient(args);
      const writes = await import('./mcpClientWrites.mjs');
      const result = await writes.createTodo(client, args);
      return textResult(result);
    }
    case 'add_subtask': {
      const client = await requireClient(args);
      const writes = await import('./mcpClientWrites.mjs');
      const result = await writes.addSubtask(client, args);
      return textResult(result);
    }
    case 'update_todo_due_date': {
      const client = await requireClient(args);
      const writes = await import('./mcpClientWrites.mjs');
      const result = await writes.updateTodoDueDate(client, args);
      return textResult(result);
    }
    case 'log_time': {
      const client = await requireClient(args);
      const writes = await import('./mcpClientWrites.mjs');
      const result = await writes.logTime(client, args);
      return textResult(result);
    }
    case 'log_expense': {
      const client = await requireClient(args);
      const writes = await import('./mcpClientWrites.mjs');
      const result = await writes.logExpense(client, args);
      return textResult(result);
    }
    case 'log_perplexity_credits': {
      const client = await requireClient(args);
      const writes = await import('./mcpClientWrites.mjs');
      const result = await writes.logPerplexityCredits(client, args);
      return textResult(result);
    }
    case 'link_document': {
      const client = await requireClient(args);
      const writes = await import('./mcpClientWrites.mjs');
      const result = await writes.linkDocument(client, args);
      return textResult(result);
    }
    case 'add_todo_comment': {
      const client = await requireClient(args);
      const writes = await import('./mcpClientWrites.mjs');
      const result = await writes.addTodoComment(client, args);
      return textResult(result);
    }
    case 'complete_todo': {
      const client = await requireClient(args);
      const writes = await import('./mcpClientWrites.mjs');
      const result = await writes.completeTodo(client, args);
      return textResult(result);
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

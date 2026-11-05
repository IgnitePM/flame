import { mcpApiKeyConfigured, verifyMcpApiKey } from './lib/mcpAuth.mjs';
import { dispatchMcpJsonRpc, MCP_SERVER_INFO } from './lib/mcpProtocol.mjs';

/**
 * Staff-only Perplexity Computer MCP connector.
 * Read tools + create_client_note / create_todo (no deletes).
 *
 * URL (production):
 *   https://<your-site>/.netlify/functions/mcp-perplexity
 *
 * Auth: Authorization: Bearer <PERPLEXITY_MCP_API_KEY>
 *   or  X-Api-Key: <PERPLEXITY_MCP_API_KEY>
 *
 * Add as a custom remote MCP connector in Perplexity → Plugins / Org Connectors.
 * Transport: Streamable HTTP. Authentication: API Key.
 */

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

function corsHeaders(req) {
  // Server-to-server connectors usually omit Origin. If a browser Origin is
  // present, do not reflect it — this endpoint is not for browser apps.
  const origin = req.headers?.get?.('origin') || req.headers?.get?.('Origin');
  if (origin) {
    return { Vary: 'Origin' };
  }
  return {};
}

function unauthorized(status, error, extraHeaders = {}) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function audit(tool, detail = {}) {
  // Avoid logging note bodies / PII payloads — ids and tool names only.
  console.info(
    '[mcp-perplexity]',
    JSON.stringify({
      at: new Date().toISOString(),
      tool: tool || null,
      ...detail,
    }),
  );
}

export default async (req) => {
  const baseHeaders = { ...JSON_HEADERS, ...corsHeaders(req) };

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...baseHeaders,
        Allow: 'POST, GET, OPTIONS',
      },
    });
  }

  if (req.method === 'GET') {
    // Discovery / health — no data without auth.
    const auth = verifyMcpApiKey(req.headers);
    if (!auth.ok) {
      return unauthorized(auth.status, auth.error, baseHeaders);
    }
    return new Response(
      JSON.stringify({
        ok: true,
        server: MCP_SERVER_INFO,
        transport: 'streamable-http',
        tools: [
          'search_clients',
          'get_client',
          'get_client_notes',
          'list_open_todos',
          'get_retainer_usage',
          'create_client_note',
          'create_todo',
        ],
        readOnly: false,
        canWrite: ['create_client_note', 'create_todo'],
      }),
      { status: 200, headers: baseHeaders },
    );
  }

  if (req.method !== 'POST') {
    return unauthorized(405, 'Method not allowed', {
      ...baseHeaders,
      Allow: 'POST, GET, OPTIONS',
    });
  }

  if (!mcpApiKeyConfigured()) {
    return unauthorized(
      503,
      'PERPLEXITY_MCP_API_KEY is not set (min 24 chars) in Netlify env.',
      baseHeaders,
    );
  }

  const auth = verifyMcpApiKey(req.headers);
  if (!auth.ok) {
    audit('auth_failed', {});
    return unauthorized(auth.status, auth.error, baseHeaders);
  }

  let message;
  try {
    message = await req.json();
  } catch {
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32700, message: 'Parse error' },
        id: null,
      }),
      { status: 400, headers: baseHeaders },
    );
  }

  const method = message?.method;
  const toolName =
    method === 'tools/call' ? message?.params?.name || null : method || null;
  audit(toolName, {
    rpc: method || null,
    clientId: message?.params?.arguments?.clientId || null,
  });

  const { status, body } = await dispatchMcpJsonRpc(message);
  if (status === 202) {
    return new Response(null, { status: 202, headers: baseHeaders });
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: baseHeaders,
  });
};

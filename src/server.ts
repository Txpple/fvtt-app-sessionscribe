// The MCP server over a registry, transport-agnostic: index.ts connects it to stdio, the tests
// connect it to an in-memory client.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { ToolRegistry } from './registry.js';

export function createServer(
  registry: ToolRegistry,
  info: { name: string; version: string }
): Server {
  const mcp = new Server(info, { capabilities: { tools: {} } });

  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: registry.tools }));

  mcp.setRequestHandler(CallToolRequestSchema, async request => {
    const { name, arguments: args } = request.params;
    try {
      const result = await registry.dispatch(name, args ?? {});
      return {
        content: [
          { type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) },
        ],
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[scribe] tool ${name} failed: ${message}`);
      return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
    }
  });

  return mcp;
}

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import type { Exec } from './health.js';
import { buildToolRegistry } from './registry.js';
import { createServer } from './server.js';

const exec: Exec = async () => ({ code: 0, stdout: 'fake 1.0\n', stderr: '' });

function build() {
  const config = loadConfig({ SCRIBE_CAMPAIGN_REPO: 'C:\\camp' });
  return buildToolRegistry({
    config,
    exec,
    exists: () => true,
    reader: async req => ({ ok: false, host: req.host, error: 'offline' }),
  });
}

describe('tool registry', () => {
  it('advertises exactly the tool surface, one definition per handler', () => {
    const { tools, handlers } = build();
    expect(tools.map(t => t.name).sort()).toEqual([
      'analyze-combat',
      'build-transcript',
      'export-session-chat',
      'fetch-recording',
      'scribe-status',
    ]);
    expect(Object.keys(handlers).sort()).toEqual(tools.map(t => t.name).sort());
  });

  it('advertises draft-2020-12-safe object schemas within the family prose budget', () => {
    for (const tool of build().tools) {
      expect(tool.inputSchema.$schema).toBeUndefined();
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toBeTypeOf('object');
      expect(Array.isArray(tool.inputSchema.required)).toBe(true);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.description.length).toBeLessThanOrEqual(400);
    }
  });

  it('rejects unknown tool names at dispatch', async () => {
    await expect(build().dispatch('nope', {})).rejects.toThrow(/Unknown tool/);
  });

  it('serves the surface over MCP: an in-memory client lists and calls the tools', async () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const server = createServer(build(), { name: 'test', version: '0.0.0' });
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await server.connect(serverSide);
    await client.connect(clientSide);
    try {
      const { tools } = await client.listTools();
      expect(tools.map(t => t.name)).toEqual([
        'scribe-status',
        'fetch-recording',
        'export-session-chat',
        'build-transcript',
        'analyze-combat',
      ]);
      const result = await client.callTool({ name: 'scribe-status', arguments: {} });
      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
      expect(JSON.parse(text)).toHaveProperty('checks.campaignRepo.ok', true);

      const bad = await client.callTool({ name: 'scribe-status', arguments: { nope: 1 } });
      expect(bad.isError).toBeFalsy(); // zod strips unknown keys on a plain object
      const unknown = await client.callTool({ name: 'nope', arguments: {} });
      expect(unknown.isError).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });
});

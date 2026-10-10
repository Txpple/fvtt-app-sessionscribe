#!/usr/bin/env node

// The MCP server entry point: a single stdio process serving the registry's tools. stdout is the
// JSON-RPC channel, so diagnostics go to stderr only, and nothing this process spawns may inherit
// stdout.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config } from './config.js';
import { childReader } from './foundry/read.js';
import { realExec, realExists } from './health.js';
import { buildToolRegistry } from './registry.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const registry = buildToolRegistry({
    config,
    exec: realExec,
    exists: realExists,
    reader: childReader(),
  });
  const mcp = createServer(registry, config.server);

  const shutdown = (): void => process.exit(0);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.stdin.on('end', shutdown);
  process.on('unhandledRejection', (reason: unknown) => {
    console.error('[sessionscribe] unhandled rejection:', reason);
  });

  await mcp.connect(new StdioServerTransport());
  console.error(`[sessionscribe] MCP server v${config.server.version} connected over stdio`);
  // A warning, never an exit: scribe-status reports the same and most tools name it per call.
  const campaignJson = config.campaignRepo && path.join(config.campaignRepo, 'campaign.json');
  if (!campaignJson) {
    console.error('[sessionscribe] warning: SCRIBE_CAMPAIGN_REPO is not set in .env');
  } else if (!fs.existsSync(campaignJson)) {
    console.error(`[sessionscribe] warning: ${campaignJson} not found (SCRIBE_CAMPAIGN_REPO)`);
  } else {
    console.error(`[sessionscribe] campaign: ${campaignJson}`);
  }
}

main().catch(err => {
  console.error('fvtt-mcp-sessionscribe failed to start:', err);
  process.exit(1);
});

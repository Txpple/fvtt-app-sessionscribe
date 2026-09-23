// The scribe's page library: bundled by esbuild.page.mjs into dist/page.bundle.js and injected
// into the headless Foundry page as window.__scribe by the reader child. Browser + Foundry
// globals only, never Node. It sits beside fvtt-mcp-dnd5e's window.__fvtt and never calls it:
// what the scribe reads is defined here, so the MCP can change without moving the record.
//
// Every op answers a JSON string. Playwright's evaluate has no serialization guard, and a live
// Document or a Map crossing it either throws opaquely or arrives as `{}`. Stringifying in-page
// makes the plain-data boundary explicit and one place.

import { scanSessionChat } from './chat.js';
import { scanCombatStats } from './combat-stats.js';
import { exportParty } from './party.js';
import { probe } from './probe.js';

const PAGE_API_VERSION = 1;

type Op = (args?: any) => unknown;

function jsonOp(fn: Op): (args?: any) => Promise<string> {
  return async args => JSON.stringify(await fn(args));
}

window.__scribe = {
  version: jsonOp(() => PAGE_API_VERSION),
  probe: jsonOp(probe),
  scanCombatStats: jsonOp(scanCombatStats),
  scanSessionChat: jsonOp(scanSessionChat),
  exportParty: jsonOp(exportParty),
};

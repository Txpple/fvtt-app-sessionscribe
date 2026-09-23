// A connection to Foundry as the scribe, for the reader child and the live parity scripts ONLY.
// The server never imports this module (it would hold a browser); it spawns the reader instead.
//
// Joins as the scribe's own user, never the MCP bridge's (two clients on one user double Battle
// Flow's automation), with the ADMIN KEY STRIPPED: it can wake a sleeping host, never launch a
// world. Injects window.__scribe the way fvtt-mcp-dnd5e injects its own bundle (an inline script
// element), beside the MCP's window.__fvtt, which the parity scripts compare against.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Foundry, foundryConfig, loadEnv } from 'fvtt-mcp-dnd5e/client';
import { config, type HostName, repoRoot } from '../config.js';

const DISPOSE_CEILING_MS = 15_000;
const silent = { debug() {}, info() {}, warn() {}, error() {} };

export const PAGE_BUNDLE = path.join(repoRoot, 'dist', 'page.bundle.js');

export interface ScribeSession {
  /** The live bridge (for the parity scripts' `f.call` against the MCP's own ops). */
  f: Foundry;
  /** Run one window.__scribe op; every op answers JSON, parsed here. */
  call<T = unknown>(op: string, args?: unknown): Promise<T>;
  /** Hang up, raced against a ceiling; never throws. */
  dispose(): Promise<void>;
}

export async function openScribeSession(host: HostName): Promise<ScribeSession> {
  if (!config.scribeUser || !config.scribePassword) {
    throw new Error('FOUNDRY_SCRIBE_USER / FOUNDRY_SCRIBE_PASSWORD are not set in the scribe .env');
  }
  const bundle = fs.readFileSync(PAGE_BUNDLE, 'utf8');
  const { adminKey: _never, ...cfg } = foundryConfig(loadEnv(), host, {
    user: config.scribeUser,
    password: config.scribePassword,
  });
  const f = new Foundry(cfg, silent);
  const dispose = async (): Promise<void> => {
    await Promise.race([
      f.dispose().catch(() => {}),
      new Promise(r => setTimeout(r, DISPOSE_CEILING_MS)),
    ]);
  };
  try {
    await f.connect();
    const injected = await f.evaluate((src: string) => {
      const s = document.createElement('script');
      s.textContent = src;
      document.head.appendChild(s);
      s.remove();
      return typeof window.__scribe === 'object';
    }, bundle);
    if (!injected) throw new Error('page bundle injected but window.__scribe is missing');
  } catch (e) {
    await dispose();
    throw e;
  }
  const call = async <T>(op: string, args?: unknown): Promise<T> =>
    JSON.parse(
      await f.evaluate(
        async ({ o, a }: { o: string; a: unknown }) => {
          const fn = window.__scribe[o];
          if (typeof fn !== 'function') throw new Error(`unknown scribe op: ${o}`);
          return fn(a);
        },
        { o: op, a: args }
      )
    ) as T;
  return { f, call, dispose };
}

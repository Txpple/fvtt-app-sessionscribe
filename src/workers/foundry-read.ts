// The one-shot reader: a child process per Foundry read, so the long-lived MCP server never holds
// a browser. It joins as the scribe's own user (never the MCP bridge's: two clients on one user
// double Battle Flow's automation) with the ADMIN KEY STRIPPED, so it can wake a sleeping host
// but never launch a world. It injects window.__scribe, probes, refuses per protocol.refusal(),
// runs one op, prints one reply line, and exits. Its own watchdog makes a hung connect or dispose
// end the process: the guarantee is that no headless GM outlives the read.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Foundry, foundryConfig, loadEnv } from 'fvtt-mcp-dnd5e/client';
import { config } from '../config.js';
import {
  DEFAULT_READ_TIMEOUT_MS,
  type ReadRequest,
  type ReadResponse,
  refusal,
  SENTINEL,
} from '../foundry/protocol.js';
import type { WorldProbe } from '../page/probe.js';

const DISPOSE_CEILING_MS = 15_000;
const silent = { debug() {}, info() {}, warn() {}, error() {} };

function reply(res: ReadResponse): void {
  process.stdout.write(`${SENTINEL}${JSON.stringify(res)}\n`);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const req = JSON.parse(await readStdin()) as ReadRequest;
  const timeoutMs = req.timeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
  const watchdog = setTimeout(() => {
    reply({
      ok: false,
      host: req.host,
      error: `reader watchdog: no answer in ${timeoutMs / 1000}s`,
    });
    process.exit(3);
  }, timeoutMs);

  if (!config.scribeUser || !config.scribePassword) {
    reply({
      ok: false,
      host: req.host,
      error: 'FOUNDRY_SCRIBE_USER / FOUNDRY_SCRIBE_PASSWORD are not set in the scribe .env',
    });
    process.exit(0);
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const bundle = fs.readFileSync(path.join(here, '..', 'page.bundle.js'), 'utf8');

  const { adminKey: _never, ...cfg } = foundryConfig(loadEnv(), req.host, {
    user: config.scribeUser,
    password: config.scribePassword,
  });
  const f = new Foundry(cfg, silent);
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

    const call = async (op: string, args?: unknown): Promise<unknown> =>
      JSON.parse(
        await f.evaluate(
          async ({ o, a }: { o: string; a: unknown }) => {
            const fn = window.__scribe[o];
            if (typeof fn !== 'function') throw new Error(`unknown scribe op: ${o}`);
            return fn(a);
          },
          { o: op, a: args }
        )
      );

    const probe = (await call('probe')) as WorldProbe;
    const refused = refusal(probe, req.worldId);
    const readAt = new Date().toISOString();
    if (refused) {
      reply({ ok: false, host: req.host, readAt, probe, error: refused });
    } else {
      const result = req.op === 'probe' ? undefined : await call(req.op, req.args);
      reply({ ok: true, host: req.host, readAt, probe, result });
    }
  } catch (e) {
    reply({ ok: false, host: req.host, error: e instanceof Error ? e.message : String(e) });
  } finally {
    await Promise.race([
      f.dispose().catch(() => {}),
      new Promise(r => setTimeout(r, DISPOSE_CEILING_MS)),
    ]);
    clearTimeout(watchdog);
    process.exit(0);
  }
}

void main();

// npm run doctor: is this machine set up to run the scribe? One line per check (✓ / ✗ / !), each
// ✗ saying the fix; exits 1 on any ✗. The checks themselves are src/doctor.ts; this file checks
// the two builds it cannot load without, then hands it the real machine.
//
//   npm run doctor                         # FOUNDRY_HOST from the env / .env (default molten)
//   FOUNDRY_HOST=local npm run doctor      # the sandbox
//
// It JOINS the world once as FOUNDRY_SCRIBE_USER (the reader child every tool uses: read-only,
// admin key stripped, hung up before it exits), so the one-world-driver rule of the live checks
// applies to a run against the sandbox.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const client = path.join(root, 'node_modules', 'fvtt-mcp-dnd5e', 'dist', 'client.js');
const built = path.join(root, 'dist', 'doctor.js');

if (!fs.existsSync(client)) {
  console.log(
    '✗ fvtt-mcp-dnd5e is not built (node_modules/fvtt-mcp-dnd5e/dist/client.js missing): ' +
      'npm ci && npm run build in ../fvtt-mcp-dnd5e, then npm install here'
  );
  process.exit(1);
}
console.log('✓ fvtt-mcp-dnd5e built (its dist/ is the Foundry client)');
if (!fs.existsSync(built)) {
  console.log('✗ this repo is not built (dist/ missing): npm run build');
  process.exit(1);
}
console.log('✓ fvtt-mcp-sessionscribe built');

const { envPath, foundryConfig, loadEnv } = await import('fvtt-mcp-dnd5e/client');
const { config } = await import('../dist/config.js');
const { childReader } = await import('../dist/foundry/read.js');
const { realExec, realExists } = await import('../dist/health.js');
const { formatLine, runDoctor } = await import('../dist/doctor.js');

const skill = path.join(root, '.claude', 'skills', 'session-scribe');
const home = path.join(os.homedir(), '.claude', 'skills', 'session-scribe');

function skillLink() {
  let stat;
  try {
    stat = fs.lstatSync(home);
  } catch {
    return 'missing';
  }
  if (!stat.isSymbolicLink()) return 'real-dir';
  let target;
  try {
    target = fs.realpathSync(home);
  } catch {
    return 'dangling';
  }
  return target === fs.realpathSync(skill) ? 'here' : { elsewhere: target };
}

const failed = await runDoctor(
  {
    config,
    exec: realExec,
    exists: realExists,
    host: config.defaultHost,
    envFile: { path: envPath(), fromOverride: Boolean(process.env.FVTT_MCP_ENV?.trim()) },
    resolveHost: () => {
      // the same resolution the reader's join makes, so a ✓ here is the join's own URL
      const cfg = foundryConfig(loadEnv(), config.defaultHost, { user: 'doctor' });
      return { serverUrl: cfg.serverUrl, ...(cfg.worldId ? { worldId: cfg.worldId } : {}) };
    },
    getStatus: async url => {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: 'manual' });
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      return { status: res.status, json };
    },
    reader: childReader(),
    skillLink,
  },
  line => console.log(formatLine(line))
);
process.exit(failed ? 1 : 0);

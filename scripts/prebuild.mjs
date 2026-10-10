// npm's prebuild: refuse to build before fvtt-mcp-dnd5e is built, then clear dist/.
//
// The Foundry client is the `file:../fvtt-mcp-dnd5e` dependency's dist/. Without it tsc fails with
// a wall of "cannot find module 'fvtt-mcp-dnd5e/client'" errors that hide the one cause; this
// says it in a line instead. The dependency is resolved the way node resolves it, through
// node_modules/fvtt-mcp-dnd5e (npm's link to the sibling), so a moved sibling is caught too.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dep = path.join(root, 'node_modules', 'fvtt-mcp-dnd5e');
const client = path.join(dep, 'dist', 'client.js');

if (!fs.existsSync(dep)) {
  console.error(
    'node_modules/fvtt-mcp-dnd5e is missing: clone fvtt-mcp-dnd5e beside this repo, build it ' +
      '(npm ci && npm run build there), then npm install here.'
  );
  process.exit(1);
}
if (!fs.existsSync(client)) {
  console.error(
    'node_modules/fvtt-mcp-dnd5e/dist/client.js is missing: build ../fvtt-mcp-dnd5e first ' +
      '(npm ci && npm run build there).'
  );
  process.exit(1);
}

fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });

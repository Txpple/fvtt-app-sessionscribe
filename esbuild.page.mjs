// Bundle the scribe's page library (src/page/**) into one IIFE that the reader child injects
// into the headless Foundry page as window.__scribe. Output: dist/page.bundle.js.
// src/page/bundle.test.ts builds the same entry with the same options in memory; change both.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/page/index.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  legalComments: 'none',
  outfile: 'dist/page.bundle.js',
  logLevel: 'info',
});

// PARITY: analyze-combat against fvtt-mcp-dnd5e's get-combat-stats, on the same world in ONE
// connection, before the MCP copy is retired. SANDBOX ONLY (FOUNDRY_HOST=local), READ-ONLY, one
// world-driver at a time: check `node ../fvtt-mcp-dnd5e/scripts/local-foundry.mjs status` and that
// no suite is running first. Needs `npm run build` here and a built fvtt-mcp-dnd5e.
//
// For every session window in the campaign repo (craig-info.json) plus the whole log:
//   1. the MCP's page scan (window.__fvtt.scanCombatStats) and ours (window.__scribe) must be
//      deep-equal once `scannedAt` is removed (ours without `until`, the MCP has none);
//   2. the MCP's fold + render (its own dist) and ours must produce identical report text.
// It also prints how many stamped messages `until` trims, the one intended difference.
//
//   FOUNDRY_HOST=local node scripts/parity-combat.mjs

import { pathToFileURL } from 'node:url';
import * as path from 'node:path';
import { foldCombatLedger, renderCombatReport } from '../dist/analytics/combat.js';
import { listSessionDirs, loadCampaign } from '../dist/campaign.js';
import { config, repoRoot } from '../dist/config.js';
import { refusal } from '../dist/foundry/protocol.js';
import { openScribeSession } from '../dist/foundry/session.js';
import { recordingWindow } from '../dist/window.js';

if ((process.env.FOUNDRY_HOST ?? '').toLowerCase() !== 'local') {
  console.error('parity-combat: SANDBOX ONLY — run with FOUNDRY_HOST=local');
  process.exit(2);
}

const mcpFold = await import(
  pathToFileURL(path.join(repoRoot, '..', 'fvtt-mcp-dnd5e', 'dist', 'tools', 'combat-stats.js'))
    .href
);

const campaign = loadCampaign(config.campaignRepo);
const windows = [{ label: 'whole log', since: 0 }];
for (const d of listSessionDirs(campaign)) {
  try {
    const w = recordingWindow(path.join(campaign.sessionsDir, d));
    windows.push({ label: d, since: w.since, until: w.until });
  } catch {
    // no recording: nothing to scope by
  }
}

/** The first path where two JSON values differ, or null. */
function firstDiff(a, b, p = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = firstDiff(a[k], b[k], `${p}.${k}`);
      if (d) return d;
    }
  }
  return p || '(root)';
}

const session = await openScribeSession('local');
let failures = 0;
try {
  const probe = await session.call('probe');
  const refused = refusal(probe, campaign.worldId);
  if (refused) throw new Error(refused);
  console.log(
    `world ${probe.worldId} · ${probe.messageCount} messages · as "${probe.user.name}" · ` +
      `GMs: ${probe.gmsConnected.map(g => g.name).join(', ')} · Battle Flow ${probe.battleflow?.version ?? 'absent'}`
  );
  for (const w of windows) {
    const theirs = await session.f.call('scanCombatStats', { since: w.since });
    const ours = await session.call('scanCombatStats', { since: w.since });
    const bounded = w.until
      ? await session.call('scanCombatStats', { since: w.since, until: w.until })
      : ours;
    const strip = s => ({ ...s, scannedAt: 0 });
    const scanDiff = firstDiff(strip(theirs), strip(ours));
    const at = theirs.scannedAt;
    const theirText = mcpFold.renderCombatReport(theirs, mcpFold.foldCombatLedger(theirs));
    const ourText = renderCombatReport({ ...ours, scannedAt: at }, foldCombatLedger(ours));
    const textOk = theirText === ourText;
    const ok = !scanDiff && textOk;
    if (!ok) failures++;
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${w.label.padEnd(26)} stamped ${String(ours.stamped.length).padStart(4)}` +
        ` · d20s ${String(ours.d20s.length).padStart(4)}` +
        `${w.until ? ` · until trims ${ours.stamped.length - bounded.stamped.length}` : ''}` +
        `${scanDiff ? ` · scan differs at ${scanDiff}` : ''}${textOk ? '' : ' · report text differs'}`
    );
  }
} finally {
  await session.dispose();
}
console.log(
  failures ? `\n${failures} window(s) FAILED` : `\nall ${windows.length} windows identical`
);
process.exit(failures ? 1 : 0);

// PARITY: export-session-chat's records against fvtt-mcp-dnd5e's export-chat-log JSON records, on
// the same world in ONE connection. SANDBOX ONLY (FOUNDRY_HOST=local), READ-ONLY, one
// world-driver at a time: check `node ../fvtt-mcp-dnd5e/scripts/local-foundry.mjs status` and that
// no suite is running first. Needs `npm run build` here and a built fvtt-mcp-dnd5e.
//
// For every session window (craig-info.json) plus the whole log: the same message ids, and on
// every field the MCP record has, the same values. The scribe's additions (whisper, whisperTo)
// are checked against the MCP's whisperCount instead.
//
//   FOUNDRY_HOST=local node scripts/parity-chat.mjs

import * as path from 'node:path';
import { listSessionDirs, loadCampaign } from '../dist/campaign.js';
import { config } from '../dist/config.js';
import { refusal } from '../dist/foundry/protocol.js';
import { openScribeSession } from '../dist/foundry/session.js';
import { recordingWindow } from '../dist/window.js';

if ((process.env.FOUNDRY_HOST ?? '').toLowerCase() !== 'local') {
  console.error('parity-chat: SANDBOX ONLY — run with FOUNDRY_HOST=local');
  process.exit(2);
}

const campaign = loadCampaign(config.campaignRepo);
const windows = [{ label: 'whole log', since: 0 }];
for (const d of listSessionDirs(campaign)) {
  try {
    windows.push({ label: d, since: recordingWindow(path.join(campaign.sessionsDir, d)).since });
  } catch {
    // no recording
  }
}

const session = await openScribeSession('local');
let failures = 0;
try {
  const probe = await session.call('probe');
  const refused = refusal(probe, campaign.worldId);
  if (refused) throw new Error(refused);
  for (const w of windows) {
    const theirs = JSON.parse(
      (await session.f.call('exportChatLog', { format: 'json', sinceTimestamp: w.since })).content
    );
    const { records: ours } = await session.call('scanSessionChat', { since: w.since });
    const problems = [];
    if (theirs.length !== ours.length) problems.push(`count ${theirs.length} vs ${ours.length}`);
    const byId = new Map(ours.map(r => [r.id, r]));
    for (const t of theirs) {
      const o = byId.get(t.id);
      if (!o) {
        problems.push(`missing ${t.id}`);
        continue;
      }
      for (const k of Object.keys(t)) {
        if (JSON.stringify(t[k]) !== JSON.stringify(o[k])) problems.push(`${t.id}.${k}`);
      }
      if (o.whisper !== t.whisperCount > 0) problems.push(`${t.id}.whisper`);
    }
    if (problems.length) failures++;
    const whispered = ours.filter(r => r.whisper).length;
    console.log(
      `${problems.length ? 'FAIL' : 'PASS'}  ${w.label.padEnd(26)} ${String(ours.length).padStart(5)} records` +
        ` · ${whispered} whispered${problems.length ? ` · ${problems.slice(0, 5).join(', ')}` : ''}`
    );
  }
} finally {
  await session.dispose();
}
console.log(
  failures ? `\n${failures} window(s) FAILED` : `\nall ${windows.length} windows identical`
);
process.exit(failures ? 1 : 0);

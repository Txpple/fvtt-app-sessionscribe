// PARITY: snapshot-party's exports against fvtt-mcp-dnd5e's `manage-actors export`, byte for
// byte, for every campaign.json party member, in ONE connection. SANDBOX ONLY
// (FOUNDRY_HOST=local), READ-ONLY, one world-driver at a time: check
// `node ../fvtt-mcp-dnd5e/scripts/local-foundry.mjs status` and that no suite is running first.
// Needs `npm run build` here and a built fvtt-mcp-dnd5e. Writes nothing.
//
//   FOUNDRY_HOST=local node scripts/parity-snapshot.mjs

import { loadCampaign } from '../dist/campaign.js';
import { config } from '../dist/config.js';
import { refusal } from '../dist/foundry/protocol.js';
import { openScribeSession } from '../dist/foundry/session.js';

if ((process.env.FOUNDRY_HOST ?? '').toLowerCase() !== 'local') {
  console.error('parity-snapshot: SANDBOX ONLY — run with FOUNDRY_HOST=local');
  process.exit(2);
}

const campaign = loadCampaign(config.campaignRepo);
const session = await openScribeSession('local');
let failures = 0;
try {
  const refused = refusal(await session.call('probe'), campaign.worldId);
  if (refused) throw new Error(refused);
  const ours = await session.call('exportParty', { names: campaign.party });
  for (const name of [...ours.missing, ...ours.ambiguous.map(a => a.name)]) {
    failures++;
    console.log(`FAIL  ${name}: not exactly one actor by that name`);
  }
  for (const a of ours.actors) {
    const theirs = await session.f.call('exportActorData', { identifier: a.id });
    const t = JSON.stringify(theirs.data, null, 2);
    const o = JSON.stringify(a.data, null, 2);
    const ok = t === o;
    if (!ok) failures++;
    let at = '';
    if (!ok) {
      let i = 0;
      while (i < t.length && t[i] === o[i]) i++;
      at = ` · first difference at byte ${i}: ${JSON.stringify(t.slice(i, i + 60))} ≠ ${JSON.stringify(o.slice(i, i + 60))}`;
    }
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${a.name.padEnd(28)} ${String(o.length).padStart(8)} bytes${at}`
    );
  }
} finally {
  await session.dispose();
}
console.log(failures ? `\n${failures} FAILED` : '\nevery party export byte-identical');
process.exit(failures ? 1 : 0);

import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import type { ReadRequest, ReadResponse } from '../foundry/protocol.js';
import type { WorldReader } from '../foundry/read.js';
import { CAMPAIGN_JSON, makeTempRepo, PARTY, removeTempRepo } from '../testing/campaign-fixture.js';
import { SnapshotPartyTool } from './snapshot-party.js';

const actorOf = (name: string) => ({
  name,
  id: name.slice(0, 1),
  type: 'character',
  data: { name, items: [{ name: 'Rope' }] },
  digest: { name, level: 3 },
});

const roots: string[] = [];
function setup(
  result: unknown,
  campaign: object = CAMPAIGN_JSON,
  files: Record<string, string> = {}
) {
  const root = makeTempRepo({ 'campaign.json': campaign, ...files });
  roots.push(root);
  const seen: ReadRequest[] = [];
  const reader: WorldReader = async <T>(req: ReadRequest) => {
    seen.push(req);
    return { ok: true, host: req.host, readAt: 'now', result } as ReadResponse<T>;
  };
  const tool = new SnapshotPartyTool({
    config: loadConfig({ SCRIBE_CAMPAIGN_REPO: root }),
    reader,
  });
  return { root, tool, seen };
}
afterEach(() => {
  for (const r of roots.splice(0)) removeTempRepo(r);
});

describe('snapshot-party', () => {
  it('asks for the campaign party only and writes each export as manage-actors export does', async () => {
    const { root, tool, seen } = setup({ actors: PARTY.map(actorOf), missing: [], ambiguous: [] });
    const out = await tool.handleSnapshotParty({ date: '2026-01-06' });
    expect(seen[0]).toMatchObject({
      op: 'exportParty',
      args: { names: PARTY },
      worldId: 'lost-mine',
    });
    const file = path.join(root, 'party-snapshots', '2026-01-06', 'Aldric Stone.json');
    expect(fs.readFileSync(file, 'utf8')).toBe(
      JSON.stringify(actorOf('Aldric Stone').data, null, 2)
    );
    expect(out.written.map(w => w.name)).toEqual(PARTY);
    expect(out.digests).toEqual(PARTY.map(n => ({ name: n, level: 3 })));
    expect(out.next).toContain(path.join('party-snapshots', '2026-01-06.md'));
  });

  it('refuses a partial snapshot, naming who is missing or ambiguous, and writes nothing', async () => {
    const { root, tool } = setup({
      actors: [actorOf('Aldric Stone')],
      missing: [],
      ambiguous: [{ name: 'Brenna Quickfoot', ids: ['x', 'y'] }],
    });
    await expect(tool.handleSnapshotParty({ date: '2026-01-06' })).rejects.toThrow(
      /refusing a partial snapshot: "Brenna Quickfoot" matches 2 actors/
    );
    expect(fs.existsSync(path.join(root, 'party-snapshots', '2026-01-06'))).toBe(false);
  });

  it('refuses to overwrite, a bad date, and a PC that is also excluded', async () => {
    const existing = setup(
      { actors: PARTY.map(actorOf), missing: [], ambiguous: [] },
      CAMPAIGN_JSON,
      { 'party-snapshots/2026-01-06/Aldric Stone.json': '{}' }
    );
    await expect(existing.tool.handleSnapshotParty({ date: '2026-01-06' })).rejects.toThrow(
      /overwrite: true/
    );
    await expect(existing.tool.handleSnapshotParty({ date: 'Jan 6' })).rejects.toThrow();
    const both = setup({}, { ...CAMPAIGN_JSON, excludedActors: ['Aldric Stone'] });
    await expect(both.tool.handleSnapshotParty({ date: '2026-01-06' })).rejects.toThrow(
      /both party and excludedActors/
    );
  });
});

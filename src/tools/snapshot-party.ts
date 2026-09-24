// snapshot-party: the party's sheets at the session's wrap, the durable "what did they have
// before" record. For every campaign.json party member (never excludedActors, never anyone
// else): <snapshots.dir>/<date>/<PC>.json, the full native export that restores through the
// sheet's Import Data button (byte-compatible with fvtt-mcp-dnd5e's manage-actors export). The
// digest facts come back for the skill, which writes <snapshots.dir>/<date>.md in prose.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { loadCampaign } from '../campaign.js';
import type { Config } from '../config.js';
import type { WorldReader } from '../foundry/read.js';
import type { PcDigest } from '../page/party.js';
import { toInputSchema } from '../utils/schema.js';
import { hostSchema } from './status.js';

const SnapshotPartySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
    .describe('The snapshot date (the session’s, YYYY-MM-DD); no session directory needed.'),
  overwrite: z.boolean().default(false).describe('Replace this date’s existing JSON exports.'),
  host: hostSchema,
});

interface PartyExport {
  actors: Array<{ name: string; id: string; type: string; data: unknown; digest: PcDigest }>;
  missing: string[];
  ambiguous: Array<{ name: string; ids: string[] }>;
}

export interface SnapshotPartyDeps {
  config: Config;
  reader: WorldReader;
}

export class SnapshotPartyTool {
  constructor(private readonly deps: SnapshotPartyDeps) {}

  getToolDefinitions() {
    return [
      {
        name: 'snapshot-party',
        description:
          "Snapshot the campaign's party at a session's wrap: each campaign.json party member's " +
          'full native export (restores via Import Data) to <snapshots.dir>/<date>/<PC>.json, ' +
          'plus the digest facts (level, HP, AC, abilities, feats, masteries, slots, attuned, ' +
          'charges, feature uses, active effects) to write <date>.md from. Party only.',
        inputSchema: toInputSchema(SnapshotPartySchema),
      },
    ];
  }

  async handleSnapshotParty(args: unknown) {
    const p = SnapshotPartySchema.parse(args ?? {});
    const campaign = loadCampaign(this.deps.config.campaignRepo);
    const excluded = campaign.party.filter(n => campaign.excludedActors.includes(n));
    if (excluded.length) {
      throw new Error(
        `campaign.json lists ${excluded.join(', ')} in both party and excludedActors`
      );
    }
    const dir = path.join(campaign.snapshotsDir, p.date);
    const files = campaign.party.map(n => path.join(dir, `${n}.json`));
    const existing = files.filter(f => fs.existsSync(f));
    if (existing.length && !p.overwrite) {
      throw new Error(
        `${existing.length} snapshot file(s) for ${p.date} exist; pass overwrite: true`
      );
    }
    const host = p.host ?? this.deps.config.defaultHost;
    const r = await this.deps.reader<PartyExport>({
      op: 'exportParty',
      args: { names: campaign.party },
      host,
      worldId: campaign.worldId,
    });
    if (!r.ok || !r.result) throw new Error(r.error ?? 'the reader returned no party');
    const { actors, missing, ambiguous } = r.result;
    if (missing.length || ambiguous.length) {
      const why = [
        ...missing.map(n => `no actor named "${n}"`),
        ...ambiguous.map(a => `"${a.name}" matches ${a.ids.length} actors (${a.ids.join(', ')})`),
      ];
      throw new Error(`refusing a partial snapshot: ${why.join('; ')}`);
    }
    fs.mkdirSync(dir, { recursive: true });
    const written = actors.map(a => {
      const file = path.join(dir, `${a.name}.json`);
      // Exactly manage-actors export's bytes: 2-space JSON, no trailing newline.
      fs.writeFileSync(file, JSON.stringify(a.data, null, 2));
      return { name: a.name, type: a.type, file, bytes: fs.statSync(file).size };
    });
    return {
      host,
      readAt: r.readAt,
      written,
      digests: actors.map(a => a.digest),
      next: `write ${path.join(campaign.snapshotsDir, `${p.date}.md`)} from the digests`,
    };
  }
}

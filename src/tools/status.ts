// scribe-status: cold-start diagnosability and the state of the record. Is every piece of the
// pipeline usable on this machine, is the campaign repo wired and valid, is the scribe's own
// Foundry login configured, and what does each session directory hold against today's
// `sessions.outputs`.

import { z } from 'zod';
import { loadCampaign } from '../campaign.js';
import {
  type HealthDeps,
  probeCampaignRepo,
  probeEdge,
  probeFfmpeg,
  probeIdentity,
  probePython,
  probeTar,
} from '../health.js';
import { recordDetail, recordSummary } from '../record.js';
import { toInputSchema } from '../utils/schema.js';

const statusSchema = z.object({
  date: z
    .string()
    .optional()
    .describe('One session in full (YYYY-MM-DD or its directory name); default: every session.'),
});

export class StatusTool {
  constructor(private readonly deps: HealthDeps) {}

  getToolDefinitions() {
    return [
      {
        name: 'scribe-status',
        description:
          'Health check and the state of the record: transcription Python, ffmpeg, tar, the PDF ' +
          "browser, the campaign repo, the scribe's Foundry login; then per session which of " +
          "the campaign's outputs, pipeline files and party snapshot exist. Call first on a cold " +
          'start.',
        inputSchema: toInputSchema(statusSchema),
      },
    ];
  }

  async handleStatus(args: unknown) {
    const { date } = statusSchema.parse(args);
    const [python, ffmpeg, tar] = await Promise.all([
      probePython(this.deps),
      probeFfmpeg(this.deps),
      probeTar(this.deps),
    ]);
    const checks = {
      python,
      ffmpeg,
      tar,
      edge: probeEdge(this.deps),
      campaignRepo: probeCampaignRepo(this.deps),
      identity: probeIdentity(this.deps),
    };
    return {
      ready: Object.values(checks).every(c => c.ok),
      defaultHost: this.deps.config.defaultHost,
      checks,
      ...this.record(date),
    };
  }

  private record(date: string | undefined) {
    try {
      const campaign = loadCampaign(this.deps.config.campaignRepo);
      if (date) return { session: recordDetail(campaign, date) };
      return {
        record: {
          campaign: campaign.name,
          worldId: campaign.worldId,
          outputs: campaign.sessions.outputs,
          pdf: campaign.sessions.pdf,
          sessions: recordSummary(campaign),
        },
      };
    } catch (e) {
      return { recordError: e instanceof Error ? e.message : String(e) };
    }
  }
}

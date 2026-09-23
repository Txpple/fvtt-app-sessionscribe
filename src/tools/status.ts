// scribe-status: cold-start diagnosability. Is every piece of the pipeline usable on this machine,
// is the campaign repo wired, is the scribe's own Foundry login configured.

import { z } from 'zod';
import {
  type HealthDeps,
  probeCampaignRepo,
  probeEdge,
  probeFfmpeg,
  probeIdentity,
  probePython,
  probeTar,
} from '../health.js';
import { toInputSchema } from '../utils/schema.js';

const statusSchema = z.object({});

export class StatusTool {
  constructor(private readonly deps: HealthDeps) {}

  getToolDefinitions() {
    return [
      {
        name: 'scribe-status',
        description:
          'Health check for the session pipeline: transcription Python, ffmpeg, tar, the PDF ' +
          "browser, the campaign repo, the scribe's own Foundry login, and the default host. " +
          'Call this first on a cold start.',
        inputSchema: toInputSchema(statusSchema),
      },
    ];
  }

  async handleStatus(args: unknown) {
    statusSchema.parse(args);
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
    };
  }
}

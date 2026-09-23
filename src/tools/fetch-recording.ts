// fetch-recording: start the job that brings a session's audio home: from the Craig link the DM
// pasted (cook → poll → download), or from the flac zip they downloaded themselves when the API
// misbehaves. Returns at once; scribe-status { date, waitSeconds } follows the job. Speakers are
// labelled from `speakers` (Discord id or username → character name), else campaign.json's
// sessions.speakers, else their Discord names.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { loadCampaign, resolveSessionDir } from '../campaign.js';
import { type Config, repoRoot } from '../config.js';
import { parseCraigUrl } from '../craig.js';
import type { FetchSpec } from '../fetch.js';
import { type StartJob, startJob } from '../jobs.js';
import { audioTracks } from '../record.js';
import { toInputSchema } from '../utils/schema.js';

export const FETCH_WORKER = path.join(repoRoot, 'dist', 'workers', 'fetch-recording.js');

const FetchRecordingSchema = z
  .object({
    date: z.string().describe('The session’s real date, YYYY-MM-DD (its directory is created).'),
    link: z.string().optional().describe('The Craig download link the DM pasted (craig.horse …).'),
    zipPath: z
      .string()
      .optional()
      .describe('Instead of a link: the flac zip the DM downloaded from the Craig page.'),
    speakers: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        'Discord id or username → transcript label; default campaign.json sessions.speakers.'
      ),
    overwrite: z
      .boolean()
      .default(false)
      .describe('Replace tracks and craig-info.json already there.'),
  })
  .refine(p => Boolean(p.link) !== Boolean(p.zipPath), {
    message: 'pass exactly one of link or zipPath',
  });

export interface FetchRecordingDeps {
  config: Config;
  launch?: (job: StartJob) => ReturnType<typeof startJob>;
}

export class FetchRecordingTool {
  constructor(private readonly deps: FetchRecordingDeps) {}

  getToolDefinitions() {
    return [
      {
        name: 'fetch-recording',
        description:
          "Start fetching a session's Craig recording: the pasted link (cook, download, extract) " +
          "or the DM's own flac zip → audio/tracks/ + craig-info.json (never the key), speakers " +
          'labelled by Discord id. Returns a job at once; follow it with scribe-status { date, ' +
          'waitSeconds }.',
        inputSchema: toInputSchema(FetchRecordingSchema),
      },
    ];
  }

  async handleFetchRecording(args: unknown) {
    const p = FetchRecordingSchema.parse(args ?? {});
    if (p.link) parseCraigUrl(p.link); // refuse a bad link now, not in the job
    const campaign = loadCampaign(this.deps.config.campaignRepo);
    const sessionDir = resolveSessionDir(campaign, p.date, { create: true });
    const tracks = audioTracks(path.join(sessionDir, 'audio', 'tracks'));
    const hasInfo = fs.existsSync(path.join(sessionDir, 'craig-info.json'));
    if ((tracks.length || hasInfo) && !p.overwrite) {
      throw new Error(
        `${sessionDir} already has ${tracks.length ? `${tracks.length} audio tracks` : 'a craig-info.json'}; ` +
          'pass overwrite: true to fetch again'
      );
    }
    fs.mkdirSync(sessionDir, { recursive: true });
    const speakers = p.speakers ?? campaign.sessions.speakers;
    const spec: FetchSpec = {
      mode: p.link ? 'link' : 'zip',
      sessionDir,
      ...(p.zipPath ? { zipPath: path.resolve(p.zipPath) } : {}),
      ...(speakers ? { speakers } : {}),
      overwrite: p.overwrite,
    };
    const job = (this.deps.launch ?? startJob)({
      sessionDir,
      kind: 'fetch',
      command: process.execPath,
      args: [FETCH_WORKER],
      spec: spec as unknown as Record<string, unknown>,
      ...(p.link ? { env: { SCRIBE_CRAIG_URL: p.link } } : {}),
    });
    return {
      job,
      sessionDir,
      speakersFrom: p.speakers
        ? 'argument'
        : campaign.sessions.speakers
          ? 'campaign.json'
          : 'Discord names',
      next: `scribe-status { date: "${path.basename(sessionDir)}", waitSeconds: 120 } until done`,
    };
  }
}

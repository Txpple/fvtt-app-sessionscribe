// transcribe-recording: start the job that turns a session's audio tracks into
// transcript-segments.json, per speaker, with faster-whisper (worker/transcribe.py, the
// scribe's only Python). Minutes on a big GPU, far longer on CPU: it runs detached and returns at
// once; scribe-status { date, waitSeconds } follows it. A killed or crashed run resumes from the
// tracks it had finished unless `fresh`.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { loadCampaign, resolveSessionDir } from '../campaign.js';
import { type Config, repoRoot } from '../config.js';
import { type StartJob, startJob } from '../jobs.js';
import { audioTracks } from '../record.js';
import { toInputSchema } from '../utils/schema.js';

export const TRANSCRIBE_WORKER = path.join(repoRoot, 'worker', 'transcribe.py');

const TranscribeRecordingSchema = z.object({
  date: z.string().describe('The session (YYYY-MM-DD or its directory name).'),
  model: z
    .string()
    .default('large-v3-turbo')
    .describe('faster-whisper model: large-v3-turbo (default), or large-v3 for maximum accuracy.'),
  device: z.enum(['auto', 'cuda', 'cpu']).default('auto').describe('auto: CUDA, else CPU int8.'),
  language: z.string().default('en').describe('Spoken language; "" to autodetect per track.'),
  fresh: z.boolean().default(false).describe('Ignore tracks finished by an earlier run.'),
  overwrite: z.boolean().default(false).describe('Replace an existing transcript-segments.json.'),
});

export interface TranscribeRecordingDeps {
  config: Config;
  launch?: (job: StartJob) => ReturnType<typeof startJob>;
}

export class TranscribeRecordingTool {
  constructor(private readonly deps: TranscribeRecordingDeps) {}

  getToolDefinitions() {
    return [
      {
        name: 'transcribe-recording',
        description:
          "Start transcribing a session's audio tracks, one per speaker, with faster-whisper " +
          '(VAD on) → transcript-segments.json. A detached job (minutes on a GPU): returns at ' +
          'once; follow it with scribe-status { date, waitSeconds }. Resumes from finished ' +
          'tracks after a crash.',
        inputSchema: toInputSchema(TranscribeRecordingSchema),
      },
    ];
  }

  async handleTranscribeRecording(args: unknown) {
    const p = TranscribeRecordingSchema.parse(args ?? {});
    const campaign = loadCampaign(this.deps.config.campaignRepo);
    const sessionDir = resolveSessionDir(campaign, p.date);
    const tracks = audioTracks(path.join(sessionDir, 'audio', 'tracks'));
    if (!tracks.length) {
      throw new Error(`${sessionDir} has no audio tracks: run fetch-recording first`);
    }
    const target = path.join(sessionDir, 'transcript-segments.json');
    if (fs.existsSync(target) && !p.overwrite) {
      throw new Error(`${target} exists; pass overwrite: true to transcribe again`);
    }
    if (!fs.existsSync(this.deps.config.python)) {
      throw new Error(
        `${this.deps.config.python} missing: run scripts/setup.ps1 (builds the venv)`
      );
    }
    const args_ = [
      '-u', // unbuffered: the job log shows each track as it finishes
      TRANSCRIBE_WORKER,
      'transcribe',
      '--session-dir',
      sessionDir,
      '--model',
      p.model,
      '--device',
      p.device,
      '--language',
      p.language,
      ...(p.fresh ? ['--fresh'] : []),
    ];
    const job = (this.deps.launch ?? startJob)({
      sessionDir,
      kind: 'transcribe',
      command: this.deps.config.python,
      args: args_,
      spec: { model: p.model, device: p.device, language: p.language, fresh: p.fresh },
    });
    return {
      job,
      sessionDir,
      tracks: tracks.length,
      next: `scribe-status { date: "${path.basename(sessionDir)}", waitSeconds: 300 } until done, then build-transcript`,
    };
  }
}

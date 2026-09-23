// The fetch job's process: launched detached by fetch-recording (src/jobs.ts), stdio to the
// job log. Reads its spec file, takes the Craig link from its ENVIRONMENT only (the one place the
// key travels), runs src/fetch.ts, and keeps the status file current. Every line it logs and
// every error it records is key-redacted.

import * as fs from 'node:fs';
import { config } from '../config.js';
import { parseCraigUrl, redactKey } from '../craig.js';
import { type FetchSpec, fetchRecording } from '../fetch.js';
import { realExec } from '../health.js';
import { type JobStatus, writeStatus } from '../jobs.js';

const statusFile = process.env.SCRIBE_JOB_STATUS ?? '';
const link = process.env.SCRIBE_CRAIG_URL;
let key = '';
try {
  if (link) key = parseCraigUrl(link).key;
} catch {
  // a malformed link fails inside fetchRecording with its own message
}
const startedAt = new Date().toISOString();

/** One line to the job log (this process's stdout is the log file). */
function log(line: string): void {
  process.stdout.write(`${redactKey(line, key)}
`);
}

function status(s: Omit<JobStatus, 'kind' | 'pid' | 'startedAt' | 'updatedAt'>): void {
  writeStatus(statusFile, {
    kind: 'fetch',
    pid: process.pid,
    startedAt,
    updatedAt: new Date().toISOString(),
    ...s,
  });
}

async function main(): Promise<void> {
  const spec = JSON.parse(fs.readFileSync(process.env.SCRIBE_JOB_SPEC ?? '', 'utf8')) as FetchSpec;
  status({ state: 'running', step: 'starting' });
  try {
    const result = await fetchRecording(spec, link, {
      http: fetch,
      exec: realExec,
      tar: config.tar,
      ffprobe: 'ffprobe',
      report: (step, progress) => {
        log(`[${new Date().toISOString()}] ${step}${progress ? `: ${progress}` : ''}`);
        status({
          state: 'running',
          step,
          ...(progress ? { progress: redactKey(progress, key) } : {}),
        });
      },
    });
    log(`done: ${result.tracks.length} tracks, craig-info.json written (no key)`);
    status({ state: 'done', step: 'done', result });
  } catch (e) {
    const message = redactKey(e instanceof Error ? e.message : String(e), key);
    log(`failed: ${message}`);
    status({ state: 'failed', step: 'failed', error: message });
    process.exitCode = 1;
  }
}

void main();

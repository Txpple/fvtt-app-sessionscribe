// Detached jobs for the pipeline's long steps (a Craig cook + 300 MB download; a ten-minute
// Whisper run), after fvtt-mcp-dnd5e's local-foundry.mjs spawnServer: a detached child with its
// output appended to a log, a launch record with its pid, and a status file the worker itself
// keeps current. A tool call starts the job and returns at once; scribe-status reports it (and
// can wait on it). Nothing the child prints can reach the MCP's stdout: its stdio goes to the log.
//
// Everything lives under <session>/audio/.jobs/, gitignored with the audio. The launch record
// never carries a secret: a Craig key travels to the worker in its environment only.

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const JOB_KINDS = ['fetch', 'transcribe'] as const;
export type JobKind = (typeof JOB_KINDS)[number];

/** What the worker writes (via writeStatus) as it goes. */
export interface JobStatus {
  kind: JobKind;
  state: 'running' | 'done' | 'failed';
  step?: string;
  progress?: string;
  pid: number;
  startedAt: string;
  updatedAt: string;
  result?: unknown;
  error?: string;
}

interface JobLaunch {
  kind: JobKind;
  pid: number;
  startedAt: string;
  command: string;
  args: string[];
}

export interface JobView {
  kind: JobKind;
  /** starting: launched, no status yet · died: the process is gone without a final status. */
  state: 'starting' | 'running' | 'done' | 'failed' | 'died';
  pid: number;
  startedAt: string;
  updatedAt?: string;
  step?: string;
  progress?: string;
  result?: unknown;
  error?: string;
  log: string;
  logTail?: string;
}

const LOG_TAIL = 1_200;

export function jobPaths(sessionDir: string, kind: JobKind) {
  const dir = path.join(sessionDir, 'audio', '.jobs');
  return {
    dir,
    launch: path.join(dir, `${kind}.launch.json`),
    status: path.join(dir, `${kind}.status.json`),
    spec: path.join(dir, `${kind}.spec.json`),
    log: path.join(dir, `${kind}.log`),
  };
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readJsonFile<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Atomic status write for workers (a reader never sees half a file). */
export function writeStatus(file: string, status: JobStatus): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(status, null, 2));
  fs.renameSync(tmp, file);
}

function tail(file: string): string | undefined {
  try {
    const text = fs.readFileSync(file, 'utf8').trim();
    return text ? text.slice(-LOG_TAIL) : undefined;
  } catch {
    return undefined;
  }
}

export function readJob(
  sessionDir: string,
  kind: JobKind,
  isAlive: (pid: number) => boolean = pidAlive
): JobView | null {
  const p = jobPaths(sessionDir, kind);
  const launch = readJsonFile<JobLaunch>(p.launch);
  if (!launch) return null;
  const status = readJsonFile<JobStatus>(p.status);
  const final = status?.state === 'done' || status?.state === 'failed';
  const state: JobView['state'] = final
    ? (status?.state as 'done' | 'failed')
    : isAlive(launch.pid)
      ? status
        ? 'running'
        : 'starting'
      : 'died';
  const view: JobView = { kind, state, pid: launch.pid, startedAt: launch.startedAt, log: p.log };
  if (status?.updatedAt) view.updatedAt = status.updatedAt;
  if (status?.step) view.step = status.step;
  if (status?.progress) view.progress = status.progress;
  if (status?.result !== undefined) view.result = status.result;
  if (status?.error) view.error = status.error;
  if (state === 'failed' || state === 'died') {
    const t = tail(p.log);
    if (t) view.logTail = t;
  }
  return view;
}

export function listJobs(sessionDir: string, isAlive?: (pid: number) => boolean): JobView[] {
  return JOB_KINDS.map(k => readJob(sessionDir, k, isAlive)).filter(
    (j): j is JobView => j !== null
  );
}

export const isActive = (j: JobView): boolean => j.state === 'starting' || j.state === 'running';

export interface StartJob {
  sessionDir: string;
  kind: JobKind;
  command: string;
  args: string[];
  /** Non-secret parameters, written to the spec file the worker reads. */
  spec: Record<string, unknown>;
  /** Extra environment (the one place a secret may travel). */
  env?: Record<string, string>;
  isAlive?: (pid: number) => boolean;
}

/** Launch a detached worker; refuses while the same kind is still running for this session. */
export function startJob(opts: StartJob): JobView {
  const p = jobPaths(opts.sessionDir, opts.kind);
  const existing = readJob(opts.sessionDir, opts.kind, opts.isAlive);
  if (existing && isActive(existing)) {
    throw new Error(
      `a ${opts.kind} job is already ${existing.state} for this session (pid ${existing.pid}); ` +
        'wait for it with scribe-status'
    );
  }
  fs.mkdirSync(p.dir, { recursive: true });
  fs.rmSync(p.status, { force: true });
  fs.writeFileSync(p.spec, JSON.stringify(opts.spec, null, 2));
  const fd = fs.openSync(p.log, 'w');
  let pid: number | undefined;
  try {
    const child = spawn(opts.command, opts.args, {
      detached: true,
      windowsHide: true,
      stdio: ['ignore', fd, fd],
      env: {
        ...process.env,
        ...opts.env,
        SCRIBE_JOB_KIND: opts.kind,
        SCRIBE_JOB_SPEC: p.spec,
        SCRIBE_JOB_STATUS: p.status,
      },
    });
    pid = child.pid;
    child.unref();
  } finally {
    fs.closeSync(fd);
  }
  if (pid === undefined)
    throw new Error(`could not start the ${opts.kind} worker: ${opts.command}`);
  const launch: JobLaunch = {
    kind: opts.kind,
    pid,
    startedAt: new Date().toISOString(),
    command: path.basename(opts.command),
    args: opts.args,
  };
  fs.writeFileSync(p.launch, JSON.stringify(launch, null, 2));
  return readJob(opts.sessionDir, opts.kind, opts.isAlive) as JobView;
}

/** Poll until no job of the session is active, or the wait runs out. */
export async function waitForJobs(
  sessionDir: string,
  waitSeconds: number,
  opts: { pollMs?: number; isAlive?: (pid: number) => boolean } = {}
): Promise<JobView[]> {
  const deadline = Date.now() + waitSeconds * 1000;
  for (;;) {
    const jobs = listJobs(sessionDir, opts.isAlive);
    if (!jobs.some(isActive) || Date.now() >= deadline) return jobs;
    await new Promise(r => setTimeout(r, opts.pollMs ?? 2_000));
  }
}

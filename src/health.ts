// Toolchain probes for scribe-status: each answers "is this piece of the pipeline usable on this
// machine" in well under a second, never downloading or transcribing anything. The process runner
// and the filesystem are injected so the tests never touch the real machine.

import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Config } from './config.js';

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}
export type Exec = (file: string, args: string[], timeoutMs: number) => Promise<ExecResult>;

export const realExec: Exec = (file, args, timeoutMs) =>
  new Promise(resolve => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : null) : 0;
      resolve({
        code,
        stdout: String(stdout),
        stderr: err && !stderr ? err.message : String(stderr),
      });
    });
  });

export interface Probe {
  ok: boolean;
  detail: string;
}

export interface HealthDeps {
  config: Config;
  exec: Exec;
  exists: (p: string) => boolean;
}

export const realExists = (p: string): boolean => fs.existsSync(p);

const firstLine = (s: string): string => s.trim().split(/\r?\n/)[0] ?? '';

async function probeCommand(deps: HealthDeps, file: string, args: string[]): Promise<Probe> {
  const r = await deps.exec(file, args, 10_000);
  const text = firstLine(r.stdout) || firstLine(r.stderr);
  return r.code === 0 ? { ok: true, detail: text } : { ok: false, detail: text || 'not runnable' };
}

/** The Python that runs faster-whisper. A missing venv means scripts/setup.ps1 has not run. */
export async function probePython(deps: HealthDeps): Promise<Probe> {
  const py = deps.config.python;
  if (!deps.exists(py)) {
    return { ok: false, detail: `${py} missing: run scripts/setup.ps1 (builds the venv)` };
  }
  const r = await probeCommand(deps, py, ['--version']);
  return r.ok ? { ok: true, detail: `${r.detail} (${py})` } : r;
}

export async function probeFfmpeg(deps: HealthDeps): Promise<Probe> {
  const r = await probeCommand(deps, 'ffmpeg', ['-version']);
  return r.ok ? r : { ok: false, detail: 'ffmpeg not on PATH: run scripts/setup.ps1' };
}

export async function probeTar(deps: HealthDeps): Promise<Probe> {
  if (!deps.exists(deps.config.tar)) return { ok: false, detail: `${deps.config.tar} missing` };
  return probeCommand(deps, deps.config.tar, ['--version']);
}

export function probeEdge(deps: HealthDeps): Probe {
  const edge = deps.config.edge;
  return deps.exists(edge)
    ? { ok: true, detail: edge }
    : { ok: false, detail: `${edge} missing: set SCRIBE_EDGE to a Chromium-family browser` };
}

export function probeCampaignRepo(deps: HealthDeps): Probe {
  const repo = deps.config.campaignRepo;
  if (!repo) return { ok: false, detail: 'SCRIBE_CAMPAIGN_REPO is not set in .env' };
  if (!deps.exists(path.join(repo, 'campaign.json'))) {
    return { ok: false, detail: `${repo} has no campaign.json` };
  }
  return { ok: true, detail: repo };
}

/** Never reports the password, only whether one is set. */
export function probeIdentity(deps: HealthDeps): Probe {
  const { scribeUser, scribePassword } = deps.config;
  if (!scribeUser) return { ok: false, detail: 'FOUNDRY_SCRIBE_USER is not set in .env' };
  if (!scribePassword) {
    return { ok: false, detail: `"${scribeUser}": FOUNDRY_SCRIBE_PASSWORD is not set in .env` };
  }
  return { ok: true, detail: `"${scribeUser}" (password set)` };
}

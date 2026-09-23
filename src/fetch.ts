// fetch-recording's work, run by the detached fetch worker: a Craig link (cook → poll →
// download) or the DM's own downloaded zip → <session>/audio/tracks/ + a sanitized
// craig-info.json. HTTP and process execution are injected, so the tests run the whole flow
// against fakes. The key never reaches a file, a log line, or an error message.

import { once } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import {
  applySpeakers,
  CraigClient,
  type CraigInfoFile,
  type CraigUser,
  type Fetch,
  parseCraigUrl,
  parseInfoTxt,
  redactKey,
  type SpeakerMap,
} from './craig.js';
import type { Exec } from './health.js';
import { audioTracks } from './record.js';

const DOWNLOAD_IDLE_MS = 120_000;
const TAR_TIMEOUT_MS = 15 * 60_000;

export interface FetchSpec {
  mode: 'link' | 'zip';
  sessionDir: string;
  zipPath?: string;
  speakers?: SpeakerMap;
  overwrite?: boolean;
}

export interface FetchDeps {
  http: Fetch;
  exec: Exec;
  tar: string;
  ffprobe: string;
  report: (step: string, progress?: string) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

export interface FetchResult {
  craigInfo: string;
  tracks: string[];
  durationSeconds: number | null;
  speakers: Array<{ track: number; name: string }>;
  warnings: string[];
}

async function extract(deps: FetchDeps, zip: string, tracksDir: string): Promise<void> {
  fs.mkdirSync(tracksDir, { recursive: true });
  // bsdtar reads zip and refuses entries that climb out with `..`; raw.dat is Craig's own
  // intermediate, not audio.
  const r = await deps.exec(
    deps.tar,
    ['-xf', zip, '-C', tracksDir, '--exclude', 'raw.dat'],
    TAR_TIMEOUT_MS
  );
  if (r.code !== 0) throw new Error(`extracting ${zip} failed: ${(r.stderr || r.stdout).trim()}`);
}

async function download(
  http: Fetch,
  url: string,
  file: string,
  onProgress: (bytes: number) => void
): Promise<number> {
  const ac = new AbortController();
  let idle = setTimeout(() => ac.abort(), DOWNLOAD_IDLE_MS);
  const res = await http(url, { signal: ac.signal });
  if (!res.ok || !res.body) {
    clearTimeout(idle);
    throw new Error(`download failed: HTTP ${res.status}`);
  }
  const part = `${file}.part`;
  const out = fs.createWriteStream(part);
  let bytes = 0;
  let lastReport = 0;
  try {
    for await (const chunk of Readable.fromWeb(res.body as any)) {
      clearTimeout(idle);
      idle = setTimeout(() => ac.abort(), DOWNLOAD_IDLE_MS);
      if (!out.write(chunk)) await once(out, 'drain');
      bytes += (chunk as Buffer).length;
      if (bytes - lastReport >= 16 * 1024 * 1024) {
        lastReport = bytes;
        onProgress(bytes);
      }
    }
  } finally {
    clearTimeout(idle);
    out.end();
    await once(out, 'close');
  }
  fs.renameSync(part, file);
  return bytes;
}

async function probeDuration(deps: FetchDeps, file: string): Promise<number | null> {
  const r = await deps.exec(
    deps.ffprobe,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
    60_000
  );
  const s = Number.parseFloat(r.stdout.trim());
  return r.code === 0 && Number.isFinite(s) ? s : null;
}

function check(users: CraigUser[], tracks: string[]): string[] {
  const warnings: string[] = [];
  if (users.length !== tracks.length) {
    warnings.push(`${users.length} speakers listed but ${tracks.length} audio tracks extracted`);
  }
  for (const u of users) {
    if (!tracks.some(t => new RegExp(`^${u.track}[-_]`).test(t))) {
      warnings.push(`no audio file for track ${u.track} (${u.name})`);
    }
  }
  return warnings;
}

export async function fetchRecording(
  spec: FetchSpec,
  link: string | undefined,
  deps: FetchDeps
): Promise<FetchResult> {
  const now = deps.now ?? (() => new Date());
  const audioDir = path.join(spec.sessionDir, 'audio');
  const tracksDir = path.join(audioDir, 'tracks');
  if (spec.overwrite) fs.rmSync(tracksDir, { recursive: true, force: true });
  fs.mkdirSync(audioDir, { recursive: true });

  let info: CraigInfoFile;
  if (spec.mode === 'link') {
    if (!link) throw new Error('no Craig link was handed to the fetch worker');
    const craig = parseCraigUrl(link);
    try {
      const client = new CraigClient(craig, deps.http);
      deps.report('metadata');
      const meta = await client.metadata();
      if (meta.live) throw new Error('the recording is still live: /stop Craig first');
      deps.report('cooking', 'requesting the flac/zip cook');
      const fileName = await client.cook({
        onPoll: s => deps.report('cooking', s),
        ...(deps.sleep ? { sleep: deps.sleep } : {}),
      });
      const zip = path.join(audioDir, `craig-${craig.id}.zip`);
      deps.report('downloading', fileName);
      const bytes = await download(deps.http, client.downloadUrl(fileName), zip, b =>
        deps.report('downloading', `${(b / 1e6).toFixed(0)} MB`)
      );
      deps.report('extracting', `${(bytes / 1e6).toFixed(1)} MB`);
      await extract(deps, zip, tracksDir);
      info = {
        recordingId: craig.id,
        startTime: meta.startTime,
        durationSeconds: meta.duration,
        guild: meta.guild,
        channel: meta.channel,
        users: applySpeakers(meta.users, spec.speakers),
        craigNotes: meta.notes,
        fetchedAt: now().toISOString(),
      };
    } catch (e) {
      throw new Error(redactKey(e instanceof Error ? e.message : String(e), craig.key));
    }
  } else {
    const zip = spec.zipPath ?? '';
    if (!fs.existsSync(zip)) throw new Error(`zip not found: ${zip}`);
    deps.report('extracting', zip);
    await extract(deps, zip, tracksDir);
    const infoTxt = path.join(tracksDir, 'info.txt');
    if (!fs.existsSync(infoTxt)) throw new Error(`${zip} has no info.txt: is it a Craig download?`);
    const parsed = parseInfoTxt(fs.readFileSync(infoTxt, 'utf8'));
    deps.report('measuring', 'track durations');
    const durations = await Promise.all(
      audioTracks(tracksDir).map(t => probeDuration(deps, path.join(tracksDir, t)))
    );
    const known = durations.filter((d): d is number => d !== null);
    info = {
      recordingId: parsed.recordingId ?? path.basename(zip).replace(/^craig-|\..*$/g, ''),
      startTime: parsed.startTime,
      durationSeconds: known.length ? Math.max(...known) : null,
      guild: parsed.guild,
      channel: parsed.channel,
      users: applySpeakers(parsed.users, spec.speakers),
      craigNotes: null,
      fetchedAt: now().toISOString(),
    };
  }

  const tracks = audioTracks(tracksDir);
  if (!tracks.length) throw new Error(`no audio tracks were extracted into ${tracksDir}`);
  const craigInfo = path.join(spec.sessionDir, 'craig-info.json');
  fs.writeFileSync(craigInfo, JSON.stringify(info, null, 2));
  return {
    craigInfo,
    tracks,
    durationSeconds: info.durationSeconds,
    speakers: info.users.map(u => ({ track: u.track, name: u.name })),
    warnings: check(info.users, tracks),
  };
}

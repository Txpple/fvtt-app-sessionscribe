// The session record's completeness: what a session directory holds against what the campaign's
// current `sessions.outputs` asks for, plus the pipeline intermediates and the party snapshot.
// Read-only; it never creates or repairs anything. Older sessions were made under older output
// sets, so "missing" means missing against TODAY's campaign.json, not a broken past session.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  type Campaign,
  listSessionDirs,
  type Output,
  resolveSessionDir,
  sessionDate,
} from './campaign.js';

export const AUDIO_EXTS = new Set([
  '.flac',
  '.ogg',
  '.oga',
  '.opus',
  '.m4a',
  '.aac',
  '.wav',
  '.mp3',
]);
const CRAIG_KEEP_DAYS = 7;

/** The pipeline's intermediates, in the order the pipeline writes them. */
export const PIPELINE_FILES = [
  'craig-info.json',
  'transcript-segments.json',
  'chatlog.json',
  'transcript.md',
  'transcript-public.md',
] as const;

/** Render sources the pipeline writes but no output requires (recap.pdf prints from this). */
const RENDER_SOURCES = ['recap-print.html'];

/** The deliverable files one output means (the .md is canonical, the .html and .pdf are its renders). */
export function outputFiles(output: Output, pdf: boolean): string[] {
  const md = output === 'combat-log' ? 'combat-stats.md' : `${output}.md`;
  return [md, `${output}.html`, ...(pdf ? [`${output}.pdf`] : [])];
}

export type Completeness = 'complete' | 'partial' | 'missing';

function completeness(present: number, total: number): Completeness {
  if (present === total) return 'complete';
  return present === 0 ? 'missing' : 'partial';
}

export interface FileSet {
  state: Completeness;
  present: string[];
  missing: string[];
}

function fileSet(dir: string, names: string[]): FileSet {
  const present = names.filter(n => fs.existsSync(path.join(dir, n)));
  const missing = names.filter(n => !present.includes(n));
  return { state: completeness(present.length, names.length), present, missing };
}

/** The audio files of an extracted recording, in track order. */
export function audioTracks(tracksDir: string): string[] {
  if (!fs.existsSync(tracksDir)) return [];
  return fs
    .readdirSync(tracksDir)
    .filter(f => AUDIO_EXTS.has(path.extname(f).toLowerCase()))
    .sort();
}

export interface SessionDetail {
  dir: string;
  date: string;
  path: string;
  pipeline: FileSet;
  outputs: Record<string, FileSet>;
  snapshot: FileSet;
  /** Files in the directory no output or pipeline step accounts for (older formats, extras). */
  other: string[];
  audioTracks: number;
  illustrations?: number;
  craig?: { recordedAt: string; durationMinutes: number; downloadExpiredBy: string };
}

export function sessionDetail(campaign: Campaign, dirName: string): SessionDetail {
  const dir = path.join(campaign.sessionsDir, dirName);
  const date = sessionDate(dirName);
  const outputs: Record<string, FileSet> = {};
  const expected = new Set<string>([...PIPELINE_FILES, ...RENDER_SOURCES]);
  for (const o of campaign.sessions.outputs) {
    const names = outputFiles(o, campaign.sessions.pdf);
    for (const n of names) expected.add(n);
    outputs[o] = fileSet(dir, names);
  }

  const snapNames = [`${date}.md`, ...campaign.party.map(pc => path.join(date, `${pc}.json`))];
  const snapshot = fileSet(campaign.snapshotsDir, snapNames);

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const other = entries
    .filter(e => e.isFile() && !expected.has(e.name))
    .map(e => e.name)
    .sort();

  const detail: SessionDetail = {
    dir: dirName,
    date,
    path: dir,
    pipeline: fileSet(dir, [...PIPELINE_FILES]),
    outputs,
    snapshot,
    other,
    audioTracks: audioTracks(path.join(dir, 'audio', 'tracks')).length,
  };
  if (campaign.sessions.illustrations) {
    const img = path.join(dir, 'img');
    detail.illustrations = fs.existsSync(img)
      ? fs.readdirSync(img).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).length
      : 0;
  }
  const craig = readCraigInfo(dir);
  if (craig) detail.craig = craig;
  return detail;
}

function readCraigInfo(dir: string): SessionDetail['craig'] | undefined {
  try {
    const info = JSON.parse(fs.readFileSync(path.join(dir, 'craig-info.json'), 'utf8'));
    const start = new Date(info.startTime);
    if (Number.isNaN(start.getTime())) return undefined;
    const expires = new Date(start.getTime() + CRAIG_KEEP_DAYS * 86_400_000);
    return {
      recordedAt: start.toISOString(),
      durationMinutes: Math.round(Number(info.durationSeconds ?? 0) / 60),
      downloadExpiredBy: expires.toISOString(),
    };
  } catch {
    return undefined;
  }
}

export interface SessionSummary {
  dir: string;
  pipeline: Completeness;
  outputs: Record<string, Completeness>;
  snapshot: Completeness;
}

/** One compact line per session, oldest first. */
export function recordSummary(campaign: Campaign): SessionSummary[] {
  return listSessionDirs(campaign).map(d => {
    const s = sessionDetail(campaign, d);
    return {
      dir: d,
      pipeline: s.pipeline.state,
      outputs: Object.fromEntries(Object.entries(s.outputs).map(([k, v]) => [k, v.state])),
      snapshot: s.snapshot.state,
    };
  });
}

/** One session's full detail, `date` resolved like every other tool resolves it. */
export function recordDetail(campaign: Campaign, date: string): SessionDetail {
  return sessionDetail(campaign, path.basename(resolveSessionDir(campaign, date)));
}

// A session's time window, the one scope every Foundry read of the night uses: the Craig
// recording (craig-info.json's startTime + durationSeconds) padded on both sides, so a roll made
// just before /join or after /stop still lands in the night it belongs to. Explicit since/until
// override either end. Epoch ms throughout; Foundry chat messages carry epoch-ms timestamps.

import * as fs from 'node:fs';
import * as path from 'node:path';

export const WINDOW_PAD_MS = 10 * 60_000;

export interface TimeWindow {
  since: number;
  /** Absent = open-ended (to the end of the log). */
  until?: number;
  /** Where the bounds came from, printed into every output built on them. */
  source: string;
}

/** Parse an ISO date or an epoch-ms string. Throws on anything else. */
export function parseInstant(label: string, value: string): number {
  const ms = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`${label} "${value}" is not an ISO date or epoch ms`);
  return ms;
}

/** The padded recording window of a session directory, from its craig-info.json. */
export function recordingWindow(sessionDir: string): { since: number; until: number } {
  const file = path.join(sessionDir, 'craig-info.json');
  let info: { startTime?: unknown; durationSeconds?: unknown };
  try {
    info = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error(`${file} not found: fetch the recording first, or pass since/until`);
  }
  const start = Date.parse(String(info.startTime));
  const seconds = Number(info.durationSeconds);
  if (!Number.isFinite(start) || !Number.isFinite(seconds)) {
    throw new Error(`${file} has no usable startTime/durationSeconds`);
  }
  return { since: start - WINDOW_PAD_MS, until: start + seconds * 1000 + WINDOW_PAD_MS };
}

/**
 * Resolve the window: explicit bounds win; a session directory supplies the rest from its
 * recording; with neither, the whole log.
 */
export function resolveWindow(opts: {
  sessionDir?: string | undefined;
  since?: string | undefined;
  until?: string | undefined;
}): TimeWindow {
  const needsRecording = opts.since === undefined || opts.until === undefined;
  const rec = opts.sessionDir && needsRecording ? recordingWindow(opts.sessionDir) : undefined;
  const since = opts.since !== undefined ? parseInstant('since', opts.since) : (rec?.since ?? 0);
  const until = opts.until !== undefined ? parseInstant('until', opts.until) : rec?.until;
  if (until !== undefined && until < since) throw new Error('until is before since');
  const parts = [
    opts.since !== undefined ? 'since given' : rec ? 'since from the recording' : 'from the start',
    opts.until !== undefined ? 'until given' : rec ? 'until from the recording' : 'to the end',
  ];
  return { since, ...(until !== undefined ? { until } : {}), source: parts.join(', ') };
}

export function describeWindow(w: TimeWindow): string {
  const iso = (ms: number) => new Date(ms).toISOString();
  return `${w.since ? iso(w.since) : 'the start'} → ${w.until !== undefined ? iso(w.until) : 'the end'} (${w.source})`;
}

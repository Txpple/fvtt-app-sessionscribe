// Craig (the Discord multitrack recorder): the link, its two download APIs, the local-zip
// fallback's info.txt, and the sanitized craig-info.json the record keeps. Ported from
// session_scribe.py `fetch` (fvtt-mcp-dnd5e). The download key lives in the link and in memory
// only: craig-info.json never carries it, because session directories get committed.
//
// "ferret" download page (CraigChat/craig apps/ferret, craig.horse, verified live 2026-07-06):
//   GET  {base}/api/v1/recordings/{id}?key=          → { recording: { startTime, expiresAfter,
//                                                        guild, channel }, users: [{track,
//                                                        username, globalName}], live }
//   GET  {base}/api/v1/recordings/{id}/duration?key= → { duration }                    (seconds)
//   POST {base}/api/v1/recordings/{id}/job?key=      body {"type":"recording","options":
//                                                        {"format":"flac","container":"zip"}}
//                                                      (400 JOB_ALREADY_EXISTS → just poll)
//   GET  {base}/api/v1/recordings/{id}/job?key=      → { job: { status, state, outputFileName,
//                                                        outputSize } | null }          (poll)
//                                                      state is an object (live 2026-09-24):
//                                                        { type: "encoding", tracks: { "3":
//                                                          { progress: 93.6, time } } }; the
//                                                        file name appears while still running
//   GET  {base}/dl/{outputFileName}                  → the cooked archive
// Legacy pages (pre-ferret) used /api/recording/{id} + /users + /duration + /notes; kept as the
// fallback when the ferret routes 404.

export interface CraigLink {
  base: string;
  id: string;
  key: string;
}

export interface CraigUser {
  track: number;
  id: string | null;
  name: string;
}

/** craig-info.json: sanitized, safe to commit. */
export interface CraigInfoFile {
  recordingId: string;
  startTime: string;
  durationSeconds: number | null;
  guild: string | null;
  channel: string | null;
  users: CraigUser[];
  craigNotes: unknown;
  fetchedAt: string;
}

/** Discord id or username (case-insensitive) → the label the transcript uses (a character name). */
export type SpeakerMap = Record<string, string>;

export function parseCraigUrl(url: string): CraigLink {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error('not a Craig link: could not parse it as a URL');
  }
  const m = /\/(?:rec|home)\/([A-Za-z0-9_-]+)/.exec(u.pathname);
  const id = m?.[1] ?? u.searchParams.get('id');
  const key = u.searchParams.get('key');
  if (!id || !key) throw new Error('not a Craig download link: no recording id and key in it');
  return { base: `${u.protocol}//${u.host}`, id, key };
}

/** The same URL with its key replaced, for anything that might be printed. */
export function redactKey(text: string, key: string): string {
  return key ? text.split(key).join('<key>') : text;
}

export function applySpeakers(users: CraigUser[], speakers: SpeakerMap | undefined): CraigUser[] {
  if (!speakers) return users;
  const byKey = new Map(Object.entries(speakers).map(([k, v]) => [k.toLowerCase(), v]));
  return users.map(u => {
    const label =
      (u.id ? byKey.get(u.id.toLowerCase()) : undefined) ??
      byKey.get(u.name.toLowerCase()) ??
      byKey.get(u.name.replace(/#\d+$/, '').toLowerCase());
    return label ? { ...u, name: label } : u;
  });
}

/**
 * The info.txt inside a Craig zip: the start time and the track list in track order. Users are
 * mapped by Discord id, never by position in some other list (track order differs per recording).
 */
export function parseInfoTxt(text: string): {
  recordingId: string | null;
  startTime: string;
  guild: string | null;
  channel: string | null;
  users: CraigUser[];
} {
  const field = (name: string) =>
    new RegExp(`^${name}:\\s*(.+?)\\s*$`, 'mi').exec(text)?.[1] ?? null;
  const withoutId = (v: string | null) => (v ? v.replace(/\s*\(\d+\)\s*$/, '') : null);
  const startTime = field('Start time');
  if (!startTime || Number.isNaN(Date.parse(startTime))) {
    throw new Error('info.txt has no usable "Start time:" line');
  }
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex(l => /^Tracks:\s*$/i.test(l));
  const users: CraigUser[] = [];
  if (at >= 0) {
    for (const l of lines.slice(at + 1)) {
      const m = /^\s+(.+?)\s*(?:\((\d+)\))?\s*$/.exec(l);
      if (!m?.[1]) break;
      users.push({ track: users.length + 1, id: m[2] ?? null, name: m[1].replace(/#0$/, '') });
    }
  }
  return {
    recordingId: /^Recording\s+(\S+)/m.exec(text)?.[1] ?? null,
    startTime,
    guild: withoutId(field('Guild')),
    channel: withoutId(field('Channel')),
    users,
  };
}

/** The cook job's `state` for the progress line: "encoding track 3 93%", never "[object Object]". */
export function describeCookState(state: unknown): string {
  if (state == null) return '-';
  if (typeof state !== 'object') return String(state);
  const s = state as { type?: unknown; tracks?: Record<string, { progress?: unknown }> };
  const type = typeof s.type === 'string' ? s.type : 'working';
  const tracks = s.tracks && typeof s.tracks === 'object' ? Object.entries(s.tracks) : [];
  const current = tracks.at(-1);
  if (!current) return type;
  const [n, t] = current;
  const pct = typeof t?.progress === 'number' ? ` ${Math.floor(t.progress)}%` : '';
  return `${type} track ${n}${pct}`;
}

// --- the API client (fetch injected; the tests never touch the network) ------------------------

export type Fetch = typeof fetch;

export class CraigHttpError extends Error {
  constructor(
    readonly status: number,
    readonly route: string,
    readonly body: unknown
  ) {
    super(`Craig answered HTTP ${status} at ${route}`);
  }
}

const UA = { 'User-Agent': 'fvtt-app-sessionscribe (personal D&D recap pipeline)' };
const REQUEST_TIMEOUT_MS = 60_000;

export class CraigClient {
  constructor(
    private readonly link: CraigLink,
    private readonly http: Fetch = fetch
  ) {}

  private url(route: string): string {
    return `${this.link.base}${route}?key=${encodeURIComponent(this.link.key)}`;
  }

  async json(route: string, body?: unknown, tolerate: number[] = []): Promise<any> {
    const res = await this.http(this.url(route), {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...UA, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const parsed = await res.json().catch(() => null);
    if (res.ok || tolerate.includes(res.status)) return parsed ?? {};
    if (res.status === 404 || res.status === 410) {
      throw new Error(
        `recording not found or expired (HTTP ${res.status} at ${route}): Craig keeps ` +
          'recordings 7 days; /recordings in Discord re-fetches a lost link'
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Craig rejected the key (HTTP ${res.status}): re-check the pasted link`);
    }
    throw new CraigHttpError(res.status, route, parsed);
  }

  /** Metadata from the ferret API, falling back to the legacy one when ferret's routes 404. */
  async metadata(): Promise<{
    startTime: string;
    guild: string | null;
    channel: string | null;
    users: CraigUser[];
    duration: number | null;
    notes: unknown;
    live: boolean;
  }> {
    const id = this.link.id;
    let d: any;
    try {
      d = await this.json(`/api/v1/recordings/${id}`);
    } catch (e) {
      if (!(e instanceof Error) || !/HTTP 404/.test(e.message)) throw e;
      return this.legacyMetadata();
    }
    const rec = d?.recording ?? {};
    const users = (d?.users ?? []).map((u: any, i: number) => ({
      track: u?.track ?? i + 1,
      id: u?.id ?? null,
      name: u?.globalName || u?.username || `track${i + 1}`,
    }));
    const duration = (await this.json(`/api/v1/recordings/${id}/duration`))?.duration ?? null;
    return {
      startTime: rec.startTime,
      guild: rec.guild?.name ?? null,
      channel: rec.channel?.name ?? null,
      users,
      duration,
      notes: null,
      live: Boolean(d?.live),
    };
  }

  private async legacyMetadata() {
    const id = this.link.id;
    const info = (await this.json(`/api/recording/${id}`))?.info ?? {};
    const raw = (await this.json(`/api/recording/${id}/users`))?.users ?? [];
    const duration = (await this.json(`/api/recording/${id}/duration`))?.duration ?? null;
    const notes = await this.json(`/api/recording/${id}/notes`).then(
      n => n?.notes ?? null,
      () => null
    );
    return {
      startTime: info.startTime,
      guild: info.guildExtra?.name ?? null,
      channel: info.channelExtra?.name ?? null,
      users: raw.map((u: any, i: number) => ({
        track: i + 1,
        id: u?.id ?? null,
        name: u?.name || `track${i + 1}`,
      })),
      duration,
      notes,
      live: false,
    };
  }

  /** Start (or adopt) the flac/zip cook and poll until done; returns the output file name. */
  async cook(
    opts: {
      pollMs?: number;
      deadlineMs?: number;
      onPoll?: (status: string) => void;
      sleep?: (ms: number) => Promise<void>;
    } = {}
  ): Promise<string> {
    const route = `/api/v1/recordings/${this.link.id}/job`;
    await this.json(
      route,
      { type: 'recording', options: { format: 'flac', container: 'zip' } },
      [400]
    );
    const sleep = opts.sleep ?? ((ms: number) => new Promise(r => setTimeout(r, ms)));
    const deadline = Date.now() + (opts.deadlineMs ?? 45 * 60_000);
    const bad = (s: unknown) => /err|fail|cancel/i.test(String(s ?? ''));
    while (Date.now() < deadline) {
      const job = (await this.json(route))?.job ?? {};
      const status = job.status as string | undefined;
      if (bad(status)) throw new Error(`the Craig cook ended badly: status=${status}`);
      if (job.outputFileName && status !== 'queued' && status !== 'running') {
        return job.outputFileName as string;
      }
      opts.onPoll?.(`${status ?? 'no job yet'} (${describeCookState(job.state)})`);
      await sleep(opts.pollMs ?? 4_000);
    }
    throw new Error(
      'the Craig cook did not finish in 45 minutes: download the flac zip from the Craig page ' +
        'and pass it as zipPath'
    );
  }

  downloadUrl(fileName: string): string {
    return `${this.link.base}/dl/${encodeURIComponent(fileName)}`;
  }
}

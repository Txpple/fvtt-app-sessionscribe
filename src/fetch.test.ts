import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type FetchDeps, fetchRecording } from './fetch.js';
import type { Exec } from './health.js';
import { fakeCraig } from './testing/fake-craig.js';

const LINK = 'https://craig.horse/rec/AbC123xyz?key=s3cr3tK3y';
const INFO_TXT = [
  'Recording AbC123xyz',
  'Guild:\t\tA Test Guild (100)',
  'Channel:\tVoice One (200)',
  'Start time:\t2026-01-06T23:00:00.000Z',
  'Tracks:',
  '\tdmhandle#0 (111)',
  '\tplayertwo#0 (222)',
  '',
].join('\n');

const dirs: string[] = [];
function sessionDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'scribe-fetch-'));
  dirs.push(d);
  return path.join(d, '2026-01-06');
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** A fake bsdtar that "extracts" a fixed track set, and a fake ffprobe. */
function fakeExec(calls: string[][]): Exec {
  return async (file, args) => {
    calls.push([path.basename(file), ...args]);
    if (file.endsWith('tar.exe')) {
      const out = args[args.indexOf('-C') + 1] ?? '';
      fs.mkdirSync(out, { recursive: true });
      for (const f of ['1-dmhandle.flac', '2-playertwo.flac'])
        fs.writeFileSync(path.join(out, f), 'x');
      fs.writeFileSync(path.join(out, 'info.txt'), INFO_TXT);
      return { code: 0, stdout: '', stderr: '' };
    }
    if (file === 'ffprobe') {
      return {
        code: 0,
        stdout: args.at(-1)?.includes('1-') ? '3600.25\n' : '3599.9\n',
        stderr: '',
      };
    }
    return { code: 1, stdout: '', stderr: 'unexpected' };
  };
}

function deps(over: Partial<FetchDeps> = {}): FetchDeps & { calls: string[][]; steps: string[] } {
  const calls: string[][] = [];
  const steps: string[] = [];
  return {
    http: fakeCraig({}),
    exec: fakeExec(calls),
    tar: 'C:\\Windows\\System32\\tar.exe',
    ffprobe: 'ffprobe',
    report: s => steps.push(s),
    sleep: async () => {},
    now: () => new Date('2026-01-07T09:00:00.000Z'),
    calls,
    steps,
    ...over,
  };
}

const ROUTES = {
  '/api/v1/recordings/AbC123xyz': {
    recording: {
      startTime: '2026-01-06T23:00:00.000Z',
      guild: { name: 'G' },
      channel: { name: 'C' },
    },
    users: [
      { track: 1, id: '111', username: 'dmhandle' },
      { track: 2, id: '222', username: 'playertwo' },
    ],
  },
  '/api/v1/recordings/AbC123xyz/duration': { duration: 3600.5 },
  '/api/v1/recordings/AbC123xyz/job': {
    job: { status: 'complete', outputFileName: 'AbC.flac.zip' },
  },
  '/dl/AbC.flac.zip': () => ({ status: 200, body: new Uint8Array([80, 75, 3, 4]) }),
};

describe('fetchRecording from a link', () => {
  it('cooks, downloads, extracts without raw.dat, and writes craig-info.json without the key', async () => {
    const dir = sessionDir();
    const d = deps({ http: fakeCraig(ROUTES) });
    const r = await fetchRecording(
      { mode: 'link', sessionDir: dir, speakers: { '111': 'DM', '222': 'Aldric Stone' } },
      LINK,
      d
    );
    expect(r.tracks).toEqual(['1-dmhandle.flac', '2-playertwo.flac']);
    expect(r.warnings).toEqual([]);
    expect(d.steps).toEqual(['metadata', 'cooking', 'downloading', 'extracting']);
    expect(fs.existsSync(path.join(dir, 'audio', 'craig-AbC123xyz.zip'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'audio', 'craig-AbC123xyz.zip.part'))).toBe(false);
    expect(d.calls[0]).toContain('--exclude');
    const text = fs.readFileSync(path.join(dir, 'craig-info.json'), 'utf8');
    expect(text).not.toContain('s3cr3tK3y');
    expect(JSON.parse(text)).toEqual({
      recordingId: 'AbC123xyz',
      startTime: '2026-01-06T23:00:00.000Z',
      durationSeconds: 3600.5,
      guild: 'G',
      channel: 'C',
      users: [
        { track: 1, id: '111', name: 'DM' },
        { track: 2, id: '222', name: 'Aldric Stone' },
      ],
      craigNotes: null,
      fetchedAt: '2026-01-07T09:00:00.000Z',
    });
  });

  it('refuses a recording that is still live, and never leaks the key in an error', async () => {
    const live = deps({
      http: fakeCraig({
        ...ROUTES,
        '/api/v1/recordings/AbC123xyz': { ...ROUTES['/api/v1/recordings/AbC123xyz'], live: true },
      }),
    });
    await expect(
      fetchRecording({ mode: 'link', sessionDir: sessionDir() }, LINK, live)
    ).rejects.toThrow(/still live/);
    const leaky = deps({
      http: (async () => {
        throw new Error(`socket hang up at ${LINK}`);
      }) as never,
    });
    const err = await fetchRecording({ mode: 'link', sessionDir: sessionDir() }, LINK, leaky).catch(
      e => e
    );
    expect(String(err.message)).toContain('key=<key>');
    expect(String(err.message)).not.toContain('s3cr3tK3y');
  });
});

describe('fetchRecording from the DM’s zip', () => {
  it('extracts, reads info.txt, measures the longest track, and labels speakers by id', async () => {
    const dir = sessionDir();
    const zip = path.join(path.dirname(dir), 'craig-AbC123xyz.flac.zip');
    fs.mkdirSync(path.dirname(zip), { recursive: true });
    fs.writeFileSync(zip, 'PK');
    const d = deps();
    const r = await fetchRecording(
      { mode: 'zip', sessionDir: dir, zipPath: zip, speakers: { '222': 'Aldric Stone' } },
      undefined,
      d
    );
    expect(r.durationSeconds).toBe(3600.25);
    expect(r.speakers).toEqual([
      { track: 1, name: 'dmhandle' },
      { track: 2, name: 'Aldric Stone' },
    ]);
    const info = JSON.parse(fs.readFileSync(path.join(dir, 'craig-info.json'), 'utf8'));
    expect(info).toMatchObject({
      recordingId: 'AbC123xyz',
      guild: 'A Test Guild',
      channel: 'Voice One',
      craigNotes: null,
    });
  });

  it('refuses a missing zip and one that is not a Craig download', async () => {
    await expect(
      fetchRecording(
        { mode: 'zip', sessionDir: sessionDir(), zipPath: 'C:\\nope.zip' },
        undefined,
        deps()
      )
    ).rejects.toThrow(/zip not found/);
    const dir = sessionDir();
    const zip = path.join(path.dirname(dir), 'other.zip');
    fs.mkdirSync(path.dirname(zip), { recursive: true });
    fs.writeFileSync(zip, 'PK');
    const noInfo: Exec = async (_f, args) => {
      fs.mkdirSync(args[args.indexOf('-C') + 1] ?? '', { recursive: true });
      return { code: 0, stdout: '', stderr: '' };
    };
    await expect(
      fetchRecording(
        { mode: 'zip', sessionDir: dir, zipPath: zip },
        undefined,
        deps({ exec: noInfo })
      )
    ).rejects.toThrow(/no info\.txt/);
  });
});

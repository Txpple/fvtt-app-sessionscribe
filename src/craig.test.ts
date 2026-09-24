import { describe, expect, it } from 'vitest';
import { applySpeakers, CraigClient, parseCraigUrl, parseInfoTxt, redactKey } from './craig.js';
import { fakeCraig } from './testing/fake-craig.js';

const LINK = 'https://craig.horse/rec/AbC123xyz?key=s3cr3tK3y';

describe('the link', () => {
  it('parses rec and home links, and refuses one without a key', () => {
    expect(parseCraigUrl(LINK)).toEqual({
      base: 'https://craig.horse',
      id: 'AbC123xyz',
      key: 's3cr3tK3y',
    });
    expect(parseCraigUrl('https://craig.chat/home/Q9?key=k').id).toBe('Q9');
    expect(parseCraigUrl('https://x.test/?id=Z&key=k').id).toBe('Z');
    expect(() => parseCraigUrl('https://craig.horse/rec/AbC')).toThrow(/no recording id and key/);
    expect(() => parseCraigUrl('not a url')).toThrow(/not a Craig link/);
  });

  it('redacts the key wherever it appears', () => {
    expect(redactKey(`GET ${LINK} failed (s3cr3tK3y)`, 's3cr3tK3y')).toBe(
      'GET https://craig.horse/rec/AbC123xyz?key=<key> failed (<key>)'
    );
    expect(redactKey('nothing', '')).toBe('nothing');
  });
});

describe('speakers', () => {
  const users = [
    { track: 1, id: '111', name: 'dmhandle' },
    { track: 2, id: '222', name: 'Player Two' },
    { track: 3, id: null, name: 'third#1234' },
  ];
  it('labels by Discord id first, then by username (case-insensitive, discriminator optional)', () => {
    expect(
      applySpeakers(users, { '111': 'DM', 'player two': 'Aldric Stone', Third: 'Brenna' })
    ).toEqual([
      { track: 1, id: '111', name: 'DM' },
      { track: 2, id: '222', name: 'Aldric Stone' },
      { track: 3, id: null, name: 'Brenna' },
    ]);
    expect(applySpeakers(users, undefined)).toBe(users);
  });
});

describe('info.txt', () => {
  const TXT = [
    'Recording AbC123xyz',
    '',
    'Guild:\t\tA Test Guild (100)',
    'Channel:\tVoice One (200)',
    'Requester:\tdmhandle#0 (111)',
    'Start time:\t2026-01-06T23:00:00.000Z',
    '',
    'Tracks:',
    '\tdmhandle#0 (111)',
    '\tplayertwo#0 (222)',
    '',
  ].join('\r\n');

  it('reads the start time and the tracks in track order, with their Discord ids', () => {
    expect(parseInfoTxt(TXT)).toEqual({
      recordingId: 'AbC123xyz',
      startTime: '2026-01-06T23:00:00.000Z',
      guild: 'A Test Guild',
      channel: 'Voice One',
      users: [
        { track: 1, id: '111', name: 'dmhandle' },
        { track: 2, id: '222', name: 'playertwo' },
      ],
    });
  });

  it('refuses an info.txt with no start time', () => {
    expect(() => parseInfoTxt('Recording X\nTracks:\n\ta (1)\n')).toThrow(/Start time/);
  });
});

describe('the ferret API', () => {
  const META = {
    '/api/v1/recordings/AbC123xyz': {
      recording: {
        startTime: '2026-01-06T23:00:00.000Z',
        guild: { name: 'G' },
        channel: { name: 'C' },
      },
      users: [
        { track: 1, id: '111', username: 'dmhandle', globalName: 'The DM' },
        { track: 2, id: '222', username: 'playertwo' },
      ],
      live: false,
    },
    '/api/v1/recordings/AbC123xyz/duration': { duration: 3600.5 },
  };

  it('reads the metadata and the duration', async () => {
    const c = new CraigClient(parseCraigUrl(LINK), fakeCraig(META));
    expect(await c.metadata()).toEqual({
      startTime: '2026-01-06T23:00:00.000Z',
      guild: 'G',
      channel: 'C',
      users: [
        { track: 1, id: '111', name: 'The DM' },
        { track: 2, id: '222', name: 'playertwo' },
      ],
      duration: 3600.5,
      notes: null,
      live: false,
    });
  });

  it('falls back to the legacy API when ferret’s routes 404', async () => {
    const c = new CraigClient(
      parseCraigUrl(LINK),
      fakeCraig({
        '/api/recording/AbC123xyz': {
          info: {
            startTime: '2026-01-06T23:00:00Z',
            guildExtra: { name: 'G' },
            channelExtra: { name: 'C' },
          },
        },
        '/api/recording/AbC123xyz/users': { users: [{ id: '111', name: 'dm' }] },
        '/api/recording/AbC123xyz/duration': { duration: 10 },
        '/api/recording/AbC123xyz/notes': { notes: [{ time: 5, note: 'mark' }] },
      })
    );
    const m = await c.metadata();
    expect(m.users).toEqual([{ track: 1, id: '111', name: 'dm' }]);
    expect(m.notes).toEqual([{ time: 5, note: 'mark' }]);
  });

  it('names an expired recording and a rejected key plainly', async () => {
    const expired = new CraigClient(parseCraigUrl(LINK), fakeCraig({}));
    await expect(expired.json('/api/v1/recordings/AbC123xyz/duration')).rejects.toThrow(
      /expired.*7 days/
    );
    const badKey = new CraigClient(
      parseCraigUrl('https://craig.horse/rec/AbC123xyz?key=wrong'),
      fakeCraig(META)
    );
    await expect(badKey.metadata()).rejects.toThrow(/rejected the key/);
  });

  it('cooks: adopts an existing job, polls, and returns the output file', async () => {
    const seen: string[] = [];
    let polls = 0;
    const c = new CraigClient(
      parseCraigUrl(LINK),
      fakeCraig(
        {
          '/api/v1/recordings/AbC123xyz/job': (init?: RequestInit) =>
            init?.method === 'POST'
              ? { status: 400, body: { code: 'JOB_ALREADY_EXISTS' } }
              : ++polls < 3
                ? {
                    status: 200,
                    body: {
                      job: {
                        status: 'running',
                        state: {
                          type: 'encoding',
                          tracks: {
                            1: { progress: 100, warn: true },
                            2: { progress: polls * 40.7 },
                          },
                        },
                        outputFileName: 'AbC123xyz.flac.zip',
                      },
                    },
                  }
                : {
                    status: 200,
                    body: { job: { status: 'complete', outputFileName: 'AbC123xyz.flac.zip' } },
                  },
        },
        seen
      )
    );
    const polled: string[] = [];
    const file = await c.cook({ sleep: async () => {}, onPoll: s => polled.push(s) });
    expect(file).toBe('AbC123xyz.flac.zip');
    expect(polled).toEqual(['running (encoding track 2 40%)', 'running (encoding track 2 81%)']);
    expect(seen[0]).toBe('POST /api/v1/recordings/AbC123xyz/job');
    expect(c.downloadUrl(file)).toBe('https://craig.horse/dl/AbC123xyz.flac.zip');
  });

  it('refuses a cook that ends badly or never finishes', async () => {
    const failing = new CraigClient(
      parseCraigUrl(LINK),
      fakeCraig({ '/api/v1/recordings/AbC123xyz/job': { job: { status: 'error' } } })
    );
    await expect(failing.cook({ sleep: async () => {} })).rejects.toThrow(
      /ended badly: status=error/
    );
    const slow = new CraigClient(
      parseCraigUrl(LINK),
      fakeCraig({ '/api/v1/recordings/AbC123xyz/job': { job: { status: 'queued' } } })
    );
    await expect(slow.cook({ sleep: async () => {}, deadlineMs: -1 })).rejects.toThrow(/zipPath/);
  });
});

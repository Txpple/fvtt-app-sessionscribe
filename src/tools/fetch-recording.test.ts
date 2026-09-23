import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import type { JobView, StartJob } from '../jobs.js';
import { CAMPAIGN_JSON, makeTempRepo, removeTempRepo } from '../testing/campaign-fixture.js';
import { FETCH_WORKER, FetchRecordingTool } from './fetch-recording.js';

const LINK = 'https://craig.horse/rec/AbC123xyz?key=s3cr3tK3y';

const roots: string[] = [];
function setup(files: Record<string, string | object> = {}, campaign: object = CAMPAIGN_JSON) {
  const root = makeTempRepo({ 'campaign.json': campaign, ...files });
  roots.push(root);
  const launched: StartJob[] = [];
  const tool = new FetchRecordingTool({
    config: loadConfig({ SCRIBE_CAMPAIGN_REPO: root }),
    launch: job => {
      launched.push(job);
      return { kind: job.kind, state: 'starting', pid: 1, startedAt: 't', log: 'l' } as JobView;
    },
  });
  return { root, tool, launched };
}
afterEach(() => {
  for (const r of roots.splice(0)) removeTempRepo(r);
});

describe('fetch-recording', () => {
  it('creates the session directory and launches the worker with the link in its env only', async () => {
    const { root, tool, launched } = setup();
    const out = await tool.handleFetchRecording({ date: '2026-01-06', link: LINK });
    const dir = path.join(root, 'sessions', '2026-01-06');
    expect(fs.existsSync(dir)).toBe(true);
    expect(launched).toHaveLength(1);
    const job = launched[0] as StartJob;
    expect(job.args).toEqual([FETCH_WORKER]);
    expect(job.env).toEqual({ SCRIBE_CRAIG_URL: LINK });
    expect(JSON.stringify(job.spec)).not.toContain('s3cr3tK3y');
    expect(job.spec).toEqual({ mode: 'link', sessionDir: dir, overwrite: false });
    expect(out).toMatchObject({ sessionDir: dir, speakersFrom: 'Discord names' });
  });

  it("takes speakers from campaign.json's sessions.speakers unless given, and a zip path", async () => {
    const campaign = {
      ...CAMPAIGN_JSON,
      sessions: { ...CAMPAIGN_JSON.sessions, speakers: { '111': 'DM' } },
    };
    const { tool, launched } = setup({}, campaign);
    const out = await tool.handleFetchRecording({
      date: '2026-01-06',
      zipPath: 'C:\\dl\\craig.zip',
    });
    expect(launched[0]?.spec).toMatchObject({
      mode: 'zip',
      zipPath: path.resolve('C:\\dl\\craig.zip'),
      speakers: { '111': 'DM' },
    });
    expect(launched[0]?.env).toBeUndefined();
    expect(out.speakersFrom).toBe('campaign.json');
    await tool.handleFetchRecording({ date: '2026-01-13', link: LINK, speakers: { '111': 'GM' } });
    expect(launched[1]?.spec).toMatchObject({ speakers: { '111': 'GM' } });
  });

  it('refuses both or neither source, a bad link, and a session already fetched', async () => {
    const { tool } = setup({ 'sessions/2026-01-06/audio/tracks/1-a.flac': 'x' });
    await expect(tool.handleFetchRecording({ date: '2026-01-06' })).rejects.toThrow(/exactly one/);
    await expect(
      tool.handleFetchRecording({ date: '2026-01-06', link: LINK, zipPath: 'x.zip' })
    ).rejects.toThrow(/exactly one/);
    await expect(
      tool.handleFetchRecording({ date: '2026-01-13', link: 'https://craig.horse/rec/X' })
    ).rejects.toThrow(/no recording id and key/);
    await expect(tool.handleFetchRecording({ date: '2026-01-06', link: LINK })).rejects.toThrow(
      /already has 1 audio tracks/
    );
    await expect(
      tool.handleFetchRecording({ date: '2026-01-06', link: LINK, overwrite: true })
    ).resolves.toBeDefined();
  });
});

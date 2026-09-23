import { afterEach, describe, expect, it } from 'vitest';
import { loadCampaign } from './campaign.js';
import { outputFiles, recordDetail, recordSummary } from './record.js';
import { CAMPAIGN_JSON, makeTempRepo, removeTempRepo } from './testing/campaign-fixture.js';

const roots: string[] = [];
function campaign(files: Record<string, string | object>) {
  const root = makeTempRepo({ 'campaign.json': CAMPAIGN_JSON, ...files });
  roots.push(root);
  return loadCampaign(root);
}
afterEach(() => {
  for (const r of roots.splice(0)) removeTempRepo(r);
});

const S = 'sessions/2026-01-06';
const COMPLETE = {
  [`${S}/craig-info.json`]: {
    startTime: '2026-01-06T23:00:00.000Z',
    durationSeconds: 3 * 3600 + 90,
    users: [],
  },
  [`${S}/transcript-segments.json`]: '{}',
  [`${S}/chatlog.json`]: '[]',
  [`${S}/transcript.md`]: '#',
  [`${S}/transcript-public.md`]: '#',
  ...Object.fromEntries(
    ['recap', 'combat-log', 'gm-notes-story', 'gm-notes-mechanics']
      .flatMap(o => outputFiles(o as never, true))
      .map(f => [`${S}/${f}`, 'x'])
  ),
  [`${S}/recap-print.html`]: 'x',
  [`${S}/img/01-a.jpg`]: 'x',
  [`${S}/img/02-b.jpg`]: 'x',
  [`${S}/audio/tracks/1-a.flac`]: 'x',
  [`${S}/audio/tracks/info.txt`]: 'x',
  'party-snapshots/2026-01-06.md': '#',
  'party-snapshots/2026-01-06/Aldric Stone.json': '{}',
  'party-snapshots/2026-01-06/Brenna Quickfoot.json': '{}',
};

describe('outputFiles', () => {
  it('maps each output to its deliverables; the combat log is canonical as combat-stats.md', () => {
    expect(outputFiles('recap', true)).toEqual(['recap.md', 'recap.html', 'recap.pdf']);
    expect(outputFiles('combat-log', false)).toEqual(['combat-stats.md', 'combat-log.html']);
    expect(outputFiles('gm-notes-story', true)).toEqual([
      'gm-notes-story.md',
      'gm-notes-story.html',
      'gm-notes-story.pdf',
    ]);
  });
});

describe('the record', () => {
  it('reports a complete session in full', () => {
    const d = recordDetail(campaign(COMPLETE), '2026-01-06');
    expect(d.pipeline.state).toBe('complete');
    expect(Object.values(d.outputs).map(o => o.state)).toEqual([
      'complete',
      'complete',
      'complete',
      'complete',
    ]);
    expect(d.snapshot.state).toBe('complete');
    expect(d.other).toEqual([]);
    expect(d.audioTracks).toBe(1);
    expect(d.illustrations).toBe(2);
    expect(d.craig).toEqual({
      recordedAt: '2026-01-06T23:00:00.000Z',
      durationMinutes: 182,
      downloadExpiredBy: '2026-01-13T23:00:00.000Z',
    });
  });

  it('measures an older session against today’s outputs and lists what it does hold', () => {
    const c = campaign({
      'sessions/2025-12-01/recap.md': '#',
      'sessions/2025-12-01/recap.html': '#',
      'sessions/2025-12-01/gm-notes.md': '#',
      'sessions/2025-12-01/transcript.md': '#',
      'party-snapshots/2025-12-01.md': '#',
    });
    const d = recordDetail(c, '2025-12-01');
    expect(d.outputs.recap).toEqual({
      state: 'partial',
      present: ['recap.md', 'recap.html'],
      missing: ['recap.pdf'],
    });
    expect(d.outputs['gm-notes-story']?.state).toBe('missing');
    expect(d.other).toEqual(['gm-notes.md']);
    expect(d.pipeline.state).toBe('partial');
    expect(d.snapshot.missing).toEqual([
      expect.stringMatching(/Aldric Stone\.json$/),
      expect.stringMatching(/Brenna Quickfoot\.json$/),
    ]);
    expect(d.craig).toBeUndefined();
    expect(d.audioTracks).toBe(0);
  });

  it('summarises every session, one compact entry each, oldest first', () => {
    const c = campaign({ ...COMPLETE, 'sessions/2025-12-01/recap.md': '#' });
    const s = recordSummary(c);
    expect(s.map(x => x.dir)).toEqual(['2025-12-01', '2026-01-06']);
    expect(s[0]).toEqual({
      dir: '2025-12-01',
      pipeline: 'missing',
      outputs: {
        recap: 'partial',
        'combat-log': 'missing',
        'gm-notes-story': 'missing',
        'gm-notes-mechanics': 'missing',
      },
      snapshot: 'missing',
    });
    expect(s[1]?.outputs.recap).toBe('complete');
  });
});

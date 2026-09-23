import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listSessionDirs, loadCampaign, resolveSessionDir, sessionDate } from './campaign.js';
import { CAMPAIGN_JSON, makeTempRepo, removeTempRepo } from './testing/campaign-fixture.js';

const roots: string[] = [];
function repo(files: Record<string, string | object>): string {
  const root = makeTempRepo(files);
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const r of roots.splice(0)) removeTempRepo(r);
});

describe('loadCampaign', () => {
  it('parses the convention and resolves the record directories', () => {
    const root = repo({ 'campaign.json': CAMPAIGN_JSON });
    const c = loadCampaign(root);
    expect(c.name).toBe('The Lost Mine of Phandelver');
    expect(c.party).toEqual(['Aldric Stone', 'Brenna Quickfoot']);
    expect(c.sessions.outputs).toContain('gm-notes-story');
    expect(c.sessionsDir).toBe(path.join(root, 'sessions'));
    expect(c.snapshotsDir).toBe(path.join(root, 'party-snapshots'));
  });

  it('fills the documented defaults for a minimal campaign.json', () => {
    const root = repo({ 'campaign.json': { name: 'X', worldId: 'x', party: ['A'] } });
    const c = loadCampaign(root);
    expect(c.sessions).toEqual({
      dir: 'sessions',
      outputs: ['recap', 'gm-notes'],
      pdf: false,
      skewSeconds: 0,
      illustrations: false,
    });
    expect(c.snapshots.dir).toBe('party-snapshots');
    expect(c.excludedActors).toEqual([]);
  });

  it('keeps keys it does not read (scenePacks belongs to another skill)', () => {
    const root = repo({ 'campaign.json': { ...CAMPAIGN_JSON, scenePacks: { mode: 'maps-only' } } });
    expect((loadCampaign(root) as Record<string, unknown>).scenePacks).toEqual({
      mode: 'maps-only',
    });
  });

  it('refuses with a message that names the problem', () => {
    expect(() => loadCampaign('')).toThrow(/SCRIBE_CAMPAIGN_REPO/);
    expect(() => loadCampaign(repo({}))).toThrow(/campaign\.json: not found/);
    expect(() => loadCampaign(repo({ 'campaign.json': '{nope' }))).toThrow(/campaign\.json/);
    const bad = repo({
      'campaign.json': { name: 'X', worldId: 'x', party: [], sessions: { outputs: ['poster'] } },
    });
    expect(() => loadCampaign(bad)).toThrow(/party: .*; sessions\.outputs\.0/);
  });
});

describe('session directories', () => {
  const layout = {
    'campaign.json': CAMPAIGN_JSON,
    'sessions/2026-01-06/recap.md': '#',
    'sessions/2026-01-13/recap.md': '#',
    'sessions/2026-01-13-rerun/recap.md': '#',
    'sessions/2026-01-20-pipeline-test/recap.md': '#',
    'sessions/README.md': '#',
    'sessions/notes/x.md': '#',
  };

  it('lists dated directories oldest first, ignoring everything else', () => {
    const c = loadCampaign(repo(layout));
    expect(listSessionDirs(c)).toEqual([
      '2026-01-06',
      '2026-01-13',
      '2026-01-13-rerun',
      '2026-01-20-pipeline-test',
    ]);
    expect(sessionDate('2026-01-20-pipeline-test')).toBe('2026-01-20');
  });

  it('resolves an exact name, a unique day, and refuses ambiguity or absence', () => {
    const c = loadCampaign(repo(layout));
    expect(resolveSessionDir(c, '2026-01-06')).toBe(path.join(c.sessionsDir, '2026-01-06'));
    expect(resolveSessionDir(c, '2026-01-20')).toBe(
      path.join(c.sessionsDir, '2026-01-20-pipeline-test')
    );
    expect(resolveSessionDir(c, '2026-01-13-rerun')).toBe(
      path.join(c.sessionsDir, '2026-01-13-rerun')
    );
    expect(resolveSessionDir(c, '2026-01-13')).toBe(path.join(c.sessionsDir, '2026-01-13'));
    expect(() => resolveSessionDir(c, '2026-02-01')).toThrow(/no session directory/);
    expect(() => resolveSessionDir(c, 'last tuesday')).toThrow(/YYYY-MM-DD/);
    expect(resolveSessionDir(c, '2026-02-01', { create: true })).toBe(
      path.join(c.sessionsDir, '2026-02-01')
    );
  });

  it('refuses a bare day that matches several directories', () => {
    const c = loadCampaign(
      repo({
        'campaign.json': CAMPAIGN_JSON,
        'sessions/2026-03-01-a/x': '',
        'sessions/2026-03-01-b/x': '',
      })
    );
    expect(() => resolveSessionDir(c, '2026-03-01')).toThrow(/several/);
  });
});

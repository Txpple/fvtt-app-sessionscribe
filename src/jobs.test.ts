import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { jobPaths, listJobs, readJob, startJob, waitForJobs, writeStatus } from './jobs.js';

const dirs: string[] = [];
function sessionDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'scribe-jobs-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

// A real detached worker: reads its spec, logs, writes a final status through the env contract.
function worker(dir: string, body: string): string {
  const file = path.join(dir, 'worker.mjs');
  fs.writeFileSync(
    file,
    `import * as fs from 'node:fs';
const spec = JSON.parse(fs.readFileSync(process.env.SCRIBE_JOB_SPEC, 'utf8'));
const put = s => fs.writeFileSync(process.env.SCRIBE_JOB_STATUS, JSON.stringify({ kind: process.env.SCRIBE_JOB_KIND, pid: process.pid, startedAt: 'x', updatedAt: 'y', ...s }));
${body}`
  );
  return file;
}

describe('jobs', () => {
  it('runs a detached worker to done, its output in the log and its secret only in its env', async () => {
    const dir = sessionDir();
    const script = worker(
      dir,
      `console.log('working on', spec.what, 'with', process.env.SECRET ? 'a secret' : 'nothing');
put({ state: 'done', step: 'done', result: { what: spec.what } });`
    );
    const job = startJob({
      sessionDir: dir,
      kind: 'fetch',
      command: process.execPath,
      args: [script],
      spec: { what: 'the tracks' },
      env: { SECRET: 'k3y' },
    });
    expect(['starting', 'running', 'done']).toContain(job.state);
    const [done] = await waitForJobs(dir, 20, { pollMs: 50 });
    expect(done).toMatchObject({ kind: 'fetch', state: 'done', result: { what: 'the tracks' } });
    expect(fs.readFileSync(jobPaths(dir, 'fetch').log, 'utf8')).toContain(
      'working on the tracks with a secret'
    );
    expect(fs.readFileSync(jobPaths(dir, 'fetch').launch, 'utf8')).not.toContain('k3y');
  });

  it('reports a worker that dies without a final status, with its log tail', async () => {
    const dir = sessionDir();
    const script = worker(
      dir,
      `put({ state: 'running', step: 'halfway' }); console.error('boom'); process.exit(4);`
    );
    startJob({
      sessionDir: dir,
      kind: 'transcribe',
      command: process.execPath,
      args: [script],
      spec: {},
    });
    const [died] = await waitForJobs(dir, 20, { pollMs: 50 });
    expect(died).toMatchObject({ kind: 'transcribe', state: 'died', step: 'halfway' });
    expect(died?.logTail).toContain('boom');
  });

  it('reads starting / running / failed from the files and liveness, and lists nothing unlaunched', () => {
    const dir = sessionDir();
    expect(listJobs(dir)).toEqual([]);
    const p = jobPaths(dir, 'fetch');
    fs.mkdirSync(p.dir, { recursive: true });
    fs.writeFileSync(
      p.launch,
      JSON.stringify({ kind: 'fetch', pid: 42, startedAt: 't', command: 'node', args: [] })
    );
    expect(readJob(dir, 'fetch', () => true)?.state).toBe('starting');
    writeStatus(p.status, {
      kind: 'fetch',
      state: 'running',
      pid: 42,
      startedAt: 't',
      updatedAt: 'u',
      progress: '50 MB',
    });
    expect(readJob(dir, 'fetch', () => true)).toMatchObject({
      state: 'running',
      progress: '50 MB',
    });
    fs.writeFileSync(p.log, 'line 1\nit broke\n');
    writeStatus(p.status, {
      kind: 'fetch',
      state: 'failed',
      pid: 42,
      startedAt: 't',
      updatedAt: 'u',
      error: 'it broke',
    });
    expect(readJob(dir, 'fetch', () => false)).toMatchObject({
      state: 'failed',
      error: 'it broke',
      logTail: 'line 1\nit broke',
    });
  });

  it('refuses a second job of the same kind while one is active', () => {
    const dir = sessionDir();
    const p = jobPaths(dir, 'fetch');
    fs.mkdirSync(p.dir, { recursive: true });
    fs.writeFileSync(
      p.launch,
      JSON.stringify({ kind: 'fetch', pid: 42, startedAt: 't', command: 'node', args: [] })
    );
    expect(() =>
      startJob({
        sessionDir: dir,
        kind: 'fetch',
        command: process.execPath,
        args: [],
        spec: {},
        isAlive: () => true,
      })
    ).toThrow(/already starting/);
  });
});

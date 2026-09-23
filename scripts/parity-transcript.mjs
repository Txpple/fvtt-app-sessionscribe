// PARITY: build-transcript against session_scribe.py `align` (fvtt-mcp-dnd5e), offline, on every
// real session in the campaign repo. No Foundry; nothing in the campaign repo is written: each
// session's three inputs are copied to a scratch dir and both implementations run there.
//
// The only differences allowed are the whisper fix: a line the Python printed as 💬 chat or 🎲 roll
// that the port prints as 🤫, same timestamp, same text. Anything else is a FAIL.
//
//   node scripts/parity-transcript.mjs [--python <exe>] [--out <dir>]
//
// Needs `npm run build` here; the Python is the transcription venv's by default (align itself
// is stdlib only).

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { listSessionDirs, loadCampaign } from '../dist/campaign.js';
import { config, repoRoot } from '../dist/config.js';
import { buildTranscripts, DEFAULT_ALIGN } from '../dist/transcript/align.js';

const arg = name => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const python = arg('--python') ?? config.python;
const out = arg('--out') ?? path.join(os.tmpdir(), 'scribe-parity-transcript');
const script = path.join(
  repoRoot,
  '..',
  'fvtt-mcp-dnd5e',
  '.claude',
  'skills',
  'session-scribe',
  'scripts',
  'session_scribe.py'
);

const campaign = loadCampaign(config.campaignRepo);
const INPUTS = ['craig-info.json', 'transcript-segments.json', 'chatlog.json'];
const MARK = /^> (💬|🎲|🤫) (`\[\d\d:\d\d:\d\d\]`) (.*)$/u;

let failures = 0;
let totalWhisperFixes = 0;
for (const d of listSessionDirs(campaign)) {
  const src = path.join(campaign.sessionsDir, d);
  if (!INPUTS.slice(0, 2).every(f => fs.existsSync(path.join(src, f)))) {
    console.log(`skip  ${d} (no recording inputs)`);
    continue;
  }
  const work = path.join(out, d);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  for (const f of INPUTS) {
    if (fs.existsSync(path.join(src, f))) fs.copyFileSync(path.join(src, f), path.join(work, f));
  }
  execFileSync(
    python,
    [
      script,
      'align',
      '--session-dir',
      work,
      '--skew-seconds',
      String(campaign.sessions.skewSeconds),
    ],
    {
      stdio: ['ignore', 'ignore', 'inherit'],
    }
  );
  // Python on Windows writes in text mode (CRLF); the port writes LF. Line endings are not content.
  const theirs = fs.readFileSync(path.join(work, 'transcript.md'), 'utf8').split(/\r?\n/);

  const read = f => JSON.parse(fs.readFileSync(path.join(work, f), 'utf8'));
  const chat = fs.existsSync(path.join(work, 'chatlog.json')) ? read('chatlog.json') : [];
  const built = buildTranscripts(read('craig-info.json'), read('transcript-segments.json'), chat, {
    ...DEFAULT_ALIGN,
    skewSeconds: campaign.sessions.skewSeconds,
  });
  fs.writeFileSync(path.join(work, 'transcript.ts.md'), built.full);
  fs.writeFileSync(path.join(work, 'transcript-public.ts.md'), built.public);
  const ours = built.full.split('\n');

  const problems = [];
  let fixes = 0;
  if (theirs.length !== ours.length) problems.push(`line count ${theirs.length} vs ${ours.length}`);
  const n = Math.min(theirs.length, ours.length);
  for (let i = 0; i < n; i++) {
    if (theirs[i] === ours[i]) continue;
    const a = MARK.exec(theirs[i]);
    const b = MARK.exec(ours[i]);
    if (a && b && a[1] !== '🤫' && b[1] === '🤫' && a[2] === b[2] && a[3] === b[3]) {
      fixes++;
      continue;
    }
    problems.push(
      `line ${i + 1}: ${JSON.stringify(theirs[i]).slice(0, 90)} ≠ ${JSON.stringify(ours[i]).slice(0, 90)}`
    );
  }
  const hush = ours.filter(l => l.startsWith('> 🤫')).length;
  const leaked = built.public.split('\n').filter(l => l.startsWith('> 🤫')).length;
  if (fixes !== built.stats.whispered)
    problems.push(`${fixes} whisper fixes but ${built.stats.whispered} whispered in window`);
  if (leaked) problems.push(`${leaked} 🤫 lines in the public transcript`);
  if (problems.length) failures++;
  totalWhisperFixes += fixes;
  console.log(
    `${problems.length ? 'FAIL' : 'PASS'}  ${d.padEnd(26)} ${String(ours.length).padStart(6)} lines · ` +
      `${fixes} whisper fixes (🤫 ${hush}) · public withholds ${built.stats.whispered}` +
      (problems.length ? `\n      ${problems.slice(0, 6).join('\n      ')}` : '')
  );
}
console.log(
  failures
    ? `\n${failures} session(s) FAILED`
    : `\nidentical apart from ${totalWhisperFixes} whisper fixes · outputs in ${out}`
);
process.exit(failures ? 1 : 0);

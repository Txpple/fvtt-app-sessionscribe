// Link the session-scribe skill into Claude Code's user skills, so it loads in every project.
//
//   npm run install-skill                      # → ~/.claude/skills/session-scribe
//   node scripts/install-skill.mjs <dir>       # → <dir>/.claude/skills/session-scribe (one project)
//
// The link is a directory junction on Windows (no admin rights needed), a symlink elsewhere, so a
// `git pull` here updates the skill in place. The house pattern is fvtt-mcp-dnd5e's
// scripts/install-skills.mjs; this one links the one skill and is idempotent:
//   - a link already pointing here is left alone;
//   - a link pointing anywhere else (a moved or renamed clone leaves a dangling one) is replaced;
//   - a real directory or file at that path is NEVER touched: it may be a hand-made copy with
//     edits. Move it away and rerun.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = join(REPO, '.claude', 'skills', 'session-scribe');
const target = process.argv.slice(2).find(a => !a.startsWith('--'));
const dest = join(resolve(target ?? homedir()), '.claude', 'skills', 'session-scribe');

if (!existsSync(join(SKILL, 'SKILL.md'))) {
  console.error(`${SKILL} has no SKILL.md: run this from a full clone of fvtt-mcp-sessionscribe`);
  process.exit(1);
}

let stat;
try {
  stat = lstatSync(dest);
} catch {
  stat = undefined;
}

if (stat && !stat.isSymbolicLink()) {
  console.error(
    `${dest} is a real ${stat.isDirectory() ? 'directory' : 'file'}, not a link: left alone. ` +
      'Move it away (it may hold edits) and rerun.'
  );
  process.exit(1);
}

if (stat) {
  let current;
  try {
    current = realpathSync(dest);
  } catch {
    current = undefined; // dangling
  }
  if (current && current === realpathSync(SKILL)) {
    console.log(`already linked  ${dest} → ${SKILL}`);
    process.exit(0);
  }
  console.log(`relinking  ${dest} (was → ${current ?? `${readlinkSync(dest)}, missing`})`);
  // A junction or symlink: removing it removes the link, never what it points at.
  rmSync(dest, { force: true });
}

mkdirSync(dirname(dest), { recursive: true });
symlinkSync(SKILL, dest, process.platform === 'win32' ? 'junction' : 'dir');
console.log(`linked  ${dest} → ${SKILL}`);

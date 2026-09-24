# Next session: the handoff

Written 2026-09-23 at the end of the session that built this repo (M1–M11). Read `CLAUDE.md`
first (architecture, invariants, live-check rules); this file is the work that is left, in
order, with its gates. Update it as you go, and delete a step's block when it lands.

## Where things stand

- **Built, on `main`, pushed** (`Txpple/fvtt-app-sessionscribe`, PRIVATE):
  - All eight tools.
  - The `session-scribe` skill, junctioned to `~/.claude/skills/session-scribe`.
  - The server, registered at user scope as `scribe` (`FOUNDRY_HOST=molten`) in `~/.claude.json`.
- **The offline gate** is green: 116 tests.
- **Proven for real:**
  - `build-transcript`: parity with the Python `align` on all 9 real sessions; the only
    differences are 77 whisper fixes.
  - `fetch-recording`: the zip path on the real 2026-09-22 zip.
  - `transcribe-recording`: on CUDA through the job path, resume included.
  - `render-pdf`: 2026-09-22's four PDFs match the committed page counts and sizes.
- **Proven live on the sandbox (2026-09-23 evening; Foundry 14.368, dnd5e 6.0.5, Battle Flow
  2.0.5, the scribe the only and elected GM):**
  - `verify-reader`: 4/4. No user is left connected, and nothing is modified during the join or
    in 30 s of idle.
  - `parity-combat`: all 10 windows are identical (176 stamped, 126 d20s).
  - `parity-chat`: all 10 windows are identical (531 records, 10 whispered).
  - `parity-snapshot`: all four PCs are byte-identical.
  - **Coverage caveat:** the world's chat starts at 2026-09-22. Every earlier window therefore
    holds the whole log, and the combat and chat parity really compared two inputs.
- **Not yet proven live:** the Craig *link* path. It needs a fresh recording; it is covered on
  fakes.
- **Owner rulings in force (2026-09-23):**
  - The scribe logs in as its own **Scribe Assistant** (Assistant GM) user. It exists on prod and
    the sandbox, and the password is in `.env`.
  - **`export-chat-log` stays in the MCP** as the general exporter.
  - The MCP's copies are **retired as soon as parity passes**. Parity has now passed.
- **Campaign repo:** `campaign.json` now has `sessions.speakers` (Discord id → label), pushed as
  446b184.

**Before any sandbox run:**
- Check `FOUNDRY_HOST=local node ../fvtt-mcp-dnd5e/scripts/local-foundry.mjs status`.
- Check for `node … tools/*.mjs` processes:
  `Get-CimInstance Win32_Process -Filter "Name='node.exe'"`.
- The Battle Flow session takes the sandbox for deploys and batteries, and says so by
  cross-session message. Wait for its all-clear.

## 2 · The MCP retirement: fvtt-mcp-dnd5e 4.0.0

Step 1 (the live gates) is green. The MCP is in maintenance (`CONTRIBUTING.md`): one change per
commit, the numbers in the message, `design.md` first.

The other session's work has landed. The `speakerAlias` / narrator fix shipped in 3.0.1
(da8305e), along with dnd5e 6.0.5. The MCP is at 3.0.1 with a clean tree, so the line numbers
below have drifted further. Still check `git status` there before each commit. Never rebuild
`dist/` over someone's unfinished work: the live servers run from it.

**Commit A (docs first).** `design.md` records the owner's 2026-09-23 ruling:
- it reverses 3.0 decisions #16 (session-scribe stays) and #17 (get-combat-stats stays);
- session summaries and analytics live in `fvtt-app-sessionscribe`;
- `export-chat-log` stays here.

**Commit B deletes:**
- `src/tools/combat-stats{,.test}.ts`
- `src/page/combat-stats{,.test}.ts`
- `.claude/skills/session-scribe/`

**Commit B edits** (line numbers from 2026-09-23; re-find them, they drift):
- `src/registry.ts`: the CombatStatsTools import, its construction and its handler (~56, 139, 358).
- `src/page/index.ts`: the scanCombatStats import and registration (~153, 318-319).
- `src/toolsets.ts:92`: `combat: ['configure-combat-tracker']`.
- `src/tools/registry.test.ts`: the tool count 81 → 80 (~123, 554), and the history comment (~99).
- `scripts/verify-toolsets.mjs` (~114-117): probe `configure-combat-tracker` instead.
- `docs/contracts.md`:
  - ~54: the Battle Flow row's reader is now the scribe's `analyze-combat`;
  - ~60-62: the doc claims get-combat-stats warns when Battle Flow is absent. It never did; the
    scribe's stamp line now does.
- `docs/hosts.md`: the "81 tools" and "combat tracker + analytics" mentions.
- `README.md` (~49, 58, 78, 80-83): the session-scribe row, the tool counts, the companion-module
  paragraph.
- `design.md`: the rows at ~177-179 and ~208, and the skills list at ~357-365.
- `.claude/skills/_shared/campaign-repo.md`:
  - session-scribe now lives in fvtt-app-sessionscribe;
  - document **`sessions.speakers`** (new; read by the scribe's fetch-recording);
  - document **`transcript-public.md`** (a new file in the record).
- `.claude/skills/journal-builder/SKILL.md` (~15, 138): the session-scribe mentions.
- `CHANGELOG.md`: 4.0.0, with the budgets before and after:
  - tools/list 201,562 → ~200,539;
  - skill descriptions 7,986 → ~7,526.
  - Lowering the ceilings in `src/measure.test.ts` is optional, but the convention does it.
- `package.json` and the lock: 4.0.0.

**Gates:**
- The offline gate.
- `node scripts/measure/skills-matrix.mjs`: 0 unresolved / 0 stale.
- Grep the skills by hand for `get-combat-stats` and `session-scribe`: the matrix only catches
  `mcp__…` names.
- On the sandbox: `FOUNDRY_HOST=local node scripts/verify-toolsets.mjs` and
  `FOUNDRY_HOST=local RUN_LIVE=1 npm run test:integration`.

**Then:** rebuild `dist/`, tag `v4.0.0`, push. The owner restarts Claude Code; after the restart
`get-combat-stats` is gone from `foundry-*`.

**In this repo afterwards:**
- Drop the "until the retirement" notes in `CLAUDE.md`.
- `scripts/parity-{combat,chat,snapshot}.mjs` can go: their MCP reference is gone.
  `parity-transcript.mjs` goes when `session_scribe.py` does.

## 3 · Doc pointers (one commit per repo, pushed)

Check each repo's `git status` first: other sessions work in them. At handoff Battle Flow had
uncommitted edits in `ARCHITECTURE.md`, `BACKLOG.md`, `NOTES.md` and `scripts/bash-offer.js`.
Don't commit someone else's hunks; wait or ask.

- **fvtt-mod-battleflow:**
  - `ARCHITECTURE.md` §4 (~307-309): the stamp reader is now `fvtt-app-sessionscribe`'s
    `analyze-combat`. Drop the dead `scripts/party-stats.mjs` mention (~307, ~344).
  - `DESIGN.md` ~1113: "reporting is that repo's job" now names the scribe.
- **fvtt-campaign-greenrest:**
  - `sessions/README.md` (the skill's home; add transcript-public.md to the layout).
  - `notes/session-recording-pipeline.md` (its "How to apply" names the MCP skill and
    `session_scribe.py`).
  - `notes/README.md` ~30 ("stays in the MCP repo").
  - `STYLE.md` line 3.
  - `notes/party-snapshot-at-session-wrap.md` (~12, 19).

## 4 · Battle Flow's newer stamp families (optional, owner rules on it)

The scan's key list (`src/page/combat-stats.ts`) predates `chipSpend`, `reminder` and
`damageShield(s)` (Battle Flow `ARCHITECTURE.md` ~343-346).
- **When:** only after step 1's parity. Adding them changes what counts as "stamped", and
  parity is measured against the MCP's old list.
- **How:** synthetic tests; then show the owner a report before and after on a real session
  window.

## 5 · The first real session through the scribe

When the owner pastes the next Craig link, run the skill end to end.

The link path of `fetch-recording` (cook → download) has only run against fakes. Watch its job
(`scribe-status { date, waitSeconds }`), and on failure fall back to `zipPath` with the zip the
DM downloads.

## Things learned the hard way (this session)

- **Shell quoting eats Windows backslashes.**
  - Bash heredocs → `node -e` → JS strings turned `C:\Program Files` into `C:Program Files` and
    `\t` into a tab (a registration in `~/.claude.json`, a sed on setup.ps1).
  - Use the Edit tool for any text with Windows paths, or forward slashes.
  - Back up `~/.claude.json` before touching it and diff it after.
- **msedge.exe returns before the PDF exists** (see `src/pdf.ts`).
- **A `Set` crosses the page JSON boundary as `{}`,** silently. dnd5e keeps masteries and item
  properties in Sets.
- **knip resolves the `file:../fvtt-mcp-dnd5e` junction to a real path** and calls the dependency
  unused. It is in `ignoreDependencies`, as in Battle Flow.
- **Biome rewrites some string escapes** (it turned `'\u00a0'` into a literal NBSP). Build
  invisible characters with `String.fromCharCode`.
- **Vitest re-runs a test file that another test file imports.** Shared fakes live in
  `src/testing/`.

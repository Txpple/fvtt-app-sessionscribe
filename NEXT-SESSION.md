# Next session: the handoff

First written 2026-09-23 at the end of the session that built this repo (M1–M11). Updated the
same evening, once the live gates, the MCP retirement and the doc pointers had landed. Read
`CLAUDE.md` first (architecture, invariants, live-check rules). This file is the work that is
left, in order, with its gates. Update it as you go, and delete a step's block when it lands.

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
  2.0.5; the scribe was the only GM connected, so it was the elected GM):**
  - `verify-reader`: 4/4. No user is left connected, and nothing is modified during the join or
    in 30 s of idle.
  - Parity with the MCP:
    - `analyze-combat`: 10/10 windows (176 stamped, 126 d20s).
    - `export-session-chat`: 10/10 (531 records, 10 whispered).
    - `snapshot-party`: 4/4 PCs byte-identical.
    - Chat and snapshot were re-run against MCP 4.0.0 and are still identical.
  - **Coverage caveat:** the world's chat starts at 2026-09-22. Every earlier window therefore
    holds the whole log, and the combat and chat parity really compared two inputs.
- **Retired:** `fvtt-mcp-dnd5e` 4.0.0 (33a8a70 design, 4fb1a9f release, tag `v4.0.0`, pushed).
  - `get-combat-stats`, the `session-scribe` skill and `session_scribe.py` are gone from the MCP.
  - `export-chat-log` stays there.
  - The scripts `parity-combat.mjs` and `parity-transcript.mjs` went with their references.
    `parity-chat.mjs` and `parity-snapshot.mjs` stay, as regression checks against the MCP's
    exporters.
- **Doc pointers landed:**
  - Battle Flow 863a1f4 (`ARCHITECTURE.md` §4, `DESIGN.md`).
  - The campaign repo 39ed5ca: `sessions/README.md`, `STYLE.md` and three notes. The DESKTOP-NY
    auto-sync committed those edits as "notes sync" before I could; the content is ours.
- **Not yet proven live:**
  - The Craig *link* path. It needs a fresh recording; it is covered on fakes.
  - A prod join. The scribe has never joined prod: the login-only check was blocked by the
    permission classifier. See step 1.
- **Owner rulings in force (2026-09-23):**
  - The scribe logs in as its own **Scribe Assistant** (Assistant GM) user. It exists on prod and
    the sandbox, and the password is in `.env`.
  - **`export-chat-log` stays in the MCP** as the general exporter.

**Before any sandbox run:**
- Check `FOUNDRY_HOST=local node ../fvtt-mcp-dnd5e/scripts/local-foundry.mjs status`.
- Check for `node … tools/*.mjs` / `verify-*` processes:
  `Get-CimInstance Win32_Process -Filter "Name='node.exe'"`.
- Other sessions run suites there: Battle Flow (Tester Assistant), and on 2026-09-23 also
  `fvtt-mod-partystash`. The Battle Flow session announces a hold by cross-session message; wait
  for its all-clear.

## 1 · After the owner's Claude Code restart

The restart loads MCP 4.0.0: its tool list changed.
- `get-combat-stats` must be gone from `foundry-local5e` and `foundry-molten5e`.
- The `scribe` tools must still answer.
- **The first prod join:** `mcp__scribe__scribe-status { connect: true }` (the default host is
  molten).
  - Do it when no one is playing, and ideally when no other GM is connected.
  - `verify-reader` proved on the sandbox that the elected-GM case leaves the world untouched.
  - It reports the world, the GMs connected and Battle Flow's version.

## 2 · Battle Flow's newer stamp families (optional, owner rules on it)

The scan's key list (`src/page/combat-stats.ts`) predates `chipSpend`, `reminder` and
`damageShield(s)` (Battle Flow `ARCHITECTURE.md` §4, the stamped-families table).
- **Why now:** parity is done and the MCP copy is gone, so the scan is free to evolve.
- **Effect:** adding them changes what counts as "stamped".
- **How:** synthetic tests; then show the owner a report before and after on a real session
  window.
- When it lands, drop "(not read there yet)" from Battle Flow's `reminder` row.

## 3 · The first real session through the scribe

When the owner pastes the next Craig link, run the skill end to end.

The link path of `fetch-recording` (cook → download) has only run against fakes. Watch its job
(`scribe-status { date, waitSeconds }`), and on failure fall back to `zipPath` with the zip the
DM downloads.

## Things learned the hard way

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
- **The running `scribe` server reads `.env` once, at start.** A password filled in afterwards
  needs a restart; the scripts, as fresh processes, see it at once.
- **The MCP's scripts need `FOUNDRY_HOST`,** even ones that never touch a world
  (`verify-toolsets`). Unset means `generic`, whose placeholder URL makes the server refuse to
  start.
- **The campaign repo auto-syncs** (DESKTOP-NY "notes sync" commits). Uncommitted edits there
  get swept into a generic commit, so commit promptly with a real message.

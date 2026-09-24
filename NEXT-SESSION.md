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
- **The offline gate** is green: 126 tests.
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
- **Proven on prod (2026-09-23 21:19, after the owner's restart):**
  - `scribe-status { connect: true }` joined as Scribe Assistant (role 3), the only GM and so the
    elected GM, with no combat running. It reported 485 messages and Battle Flow **2.0.4**.
  - Prod's user count was 0 before and 0 after.
  - `get-combat-stats` is gone from both `foundry-*` registrations.
- **Not yet proven live:** the Craig *link* path. It needs a fresh recording; it is covered on
  fakes.
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

## Landed: Battle Flow's newer stamp families (2026-09-23 evening)

The scan reads the contract table's 2026-09-01 and 2026-09-05 families: `reminder`,
`chipSpend`, `damageShield` and the maneuver / cast / emanation moments. On the 2026-09-22
window, stamped messages went 166 → 193, every existing number was unchanged, and the report
gained 32 reminders, 4 chips and 4 ward strikes. The owner saw the before and after.

**Contract drift, ruled and fixed (owner, 2026-09-23):** Battle Flow 91d2c16 made the table
match the code.
- `clockRiders` and `emanationCard` are rows now, and the scan reads them. Riders are counted by
  name; auras are named once, because the card is reposted each time the aura stands.
- `castApply.choice` is out: unstamped by ruling, since its effect is stamped in `effectReceipt`.
- The `reminder` row covers saves and concentration checks as well as attacks.
- On 2026-09-22: stamped 193 → 199, Jetten's Dreadful Strike ×3, Invictus's Aura of Protection.

## 1 · The first real session through the scribe

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

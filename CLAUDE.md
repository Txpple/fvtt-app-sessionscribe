# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# fvtt-app-sessionscribe

The home of **session summaries and analytics** for Foundry VTT (dnd5e) tables: an MCP server,
driven by Claude Code, plus the `session-scribe` skill. It reads what happened at a session (the
Craig voice recording, the Foundry chat log, Battle Flow's combat stats, the party's sheets) and
writes the session record into the campaign repo: recaps, combat logs, GM notes, party
snapshots. It **reads the world and never writes it**. The session-diary page and the bestiary
are authored through `fvtt-mcp-dnd5e`.

**State (2026-09-23): the port is in progress.** Milestones 1–2 have landed: the scaffold,
`scribe-status`, and campaign.json + the record view. The functionality is being broken out of
`fvtt-mcp-dnd5e` (owner ruling 2026-09-23, reversing that repo's 3.0 decisions #16 and #17).
Until a piece lands here, its source below is
the working implementation. When a piece lands, move it from "Target surface" into the
architecture notes and drop its row from "Port sources".

## Commands

```bash
npm install                 # once; fvtt-mcp-dnd5e must be built first (its dist/ is the client)
npm run build               # tsc → dist/
npm test                    # vitest, offline (src/**/*.test.ts)
npx vitest run src/tools/status.test.ts   # one file; add -t "<name>" for one test
npm run check && npm run typecheck && npm test && npm run build && npm run knip   # the gate
```

The gate runs before every commit. `npm run check:fix` applies biome's formatting. Live checks
against the sandbox will be `scripts/verify-*.mjs` / `scripts/parity-*.mjs`, run by hand.

## Architecture

- `src/index.ts` is the stdio entry point. `src/server.ts` builds the MCP server over a registry
  and is transport-agnostic; the tests drive it with an in-memory client.
- `src/registry.ts` is the single name → handler map. The advertised tool list is derived from it
  and fails fast when a handler and a definition don't match.
- Each tool is a class in `src/tools/` with a hoisted zod schema. `src/utils/schema.ts`
  (`toInputSchema`) generates the advertised JSON Schema, which is never hand-written. Keep the
  family's prose budget: a description ≤ 400 chars, a leaf `.describe()` ≤ 120.
- `src/config.ts` loads this repo's `.env` once. Nothing else reads `process.env`. Foundry host
  URLs and the admin key are not in it: they come from `fvtt-mcp-dnd5e`'s `.env` through that
  repo's client.
- Machine access (`execFile`, `fs.existsSync`) is injected through `HealthDeps`
  (`src/health.ts`), so tests never touch the real machine.
- `src/campaign.ts` is the machine side of the campaign-repo convention:
  - It parses `campaign.json` with zod and fills the defaults.
  - `resolveSessionDir` turns a `date` (or a slugged directory name like
    `2026-07-06-pipeline-test`) into a session directory; every tool that takes `date` resolves
    it this way.
- `src/record.ts` measures each session directory against today's `sessions.outputs`. Older
  sessions were made under older output sets, so "missing" there is history, not breakage.
- Test fixtures are synthetic (`src/testing/campaign-fixture.ts`: the convention's own invented
  party), written to temp dirs.

## Target surface (the approved plan; verb-noun names like the family)

| Tool | Replaces | Status |
| --- | --- | --- |
| `scribe-status` | `session_scribe.py smoke`; plus health, jobs and the record's completeness | health ✅ record ✅; jobs pending |
| `fetch-recording` | `… fetch` (Craig link or the DM's zip) | pending |
| `transcribe-recording` | `… transcribe` (a detached job, not a blocking call) | pending |
| `export-session-chat` | the scribe's use of MCP `export-chat-log` (that tool stays in the MCP for general use) | pending |
| `build-transcript` | `… align`, fixing whispers (never tagged; 77 across 9 sessions) + a new `transcript-public.md` | pending |
| `analyze-combat` | MCP `get-combat-stats` | pending |
| `snapshot-party` | hand-run `manage-actors export` per PC | pending |
| `render-pdf` | hand-run Edge + `pdf-preview.mjs` | pending |

Foundry reads will run in a **one-shot child process**, never in the server:
- It connects as **Scribe Assistant**, with the admin key stripped.
- It injects this repo's own page bundle (`window.__scribe`), reads, prints JSON, and disposes.
- A hung dispose can then never leave a headless GM joined to the world.

## Port sources: where the functionality lives today

| Piece | Source | Notes |
| --- | --- | --- |
| The pipeline, end to end | `../fvtt-mcp-dnd5e/.claude/skills/session-scribe/SKILL.md` | The 8-step run plus the recap and combat-log house defaults. Read it in full before porting any step. |
| Fetch / transcribe / align | `…/session-scribe/scripts/session_scribe.py` | Python + faster-whisper. Subcommands `smoke`, `fetch`, `transcribe`, `align`. The header documents the Craig "ferret" API. |
| Machine bootstrap | `…/session-scribe/scripts/setup.ps1` | Installs ffmpeg and uv via winget, builds the venv at `~\.session-scribe\venv`, runs a GPU smoke test. Windows-only. |
| PDF page check | `…/session-scribe/scripts/pdf-preview.mjs` | Renders a pdf.js page grid so every page can be inspected |
| Output templates | `…/session-scribe/templates/{recap,recap-print,gm-notes,combat-log}.html` | |
| Chat log export | MCP tool `export-chat-log`: `../fvtt-mcp-dnd5e/src/tools/chat.ts`, page `src/page/chat.ts` (`rawFields`, `renderSystemContent`) + `chat-helpers.ts` (`toMessageRecord`) | Reference only: the MCP keeps this tool. The record has `whisperCount`, never `whisper`. |
| Combat stats | MCP tool `get-combat-stats`: `../fvtt-mcp-dnd5e/src/tools/combat-stats.ts` (the fold is pure and unit-tested) over the page scan `src/page/combat-stats.ts` | Folds the stat stamps Battle Flow (`../fvtt-mod-battleflow`) writes onto chat messages. Without that module in the world, there are no stats. |
| Party snapshots, session-diary page | MCP tools `manage-actors` (`export`, `get`) and `manage-journals` (`update`) | |
| Illustrations | `../fvtt-mcp-artificer/.claude/skills/illustration-builder/` + the artificer MCP tools | |
| Readers of the record | MCP skills `session-audit`, `plot-drift-check`, `bestiary-builder` | They read `sessions/` and `party-snapshots/`, so a port must not change that layout without re-pointing them. |
| Locked spec and its history | `../fvtt-campaign-greenrest/notes/session-recording-pipeline.md` | The owner's decisions (email rather than Discord, no Discord bot, no mid-session marks) and their reasons |
| Reference output | `../fvtt-campaign-greenrest/sessions/` (newest: `2026-09-22/`) | Owner-approved examples of every artifact |

Precedent for a port out of the MCP repo: on 2026-09-19 the token cutout moved to
`fvtt-mcp-artificer`, and the MCP's `token-cutout` skill shrank to its Foundry-install half with a
pointer to the new home. The MCP repo is in maintenance (see its `CONTRIBUTING.md`), so retiring
anything there is a separate change. That change must re-point every skill that names the moved
tools in the same commit: `node scripts/measure/skills-matrix.mjs` must report 0 unresolved.

## Invariants the port must keep

- **The DM does four things:** `/join` Craig, play, `/stop`, paste the link. Never ask them to
  mark, export or download anything. If they said "mark that" aloud, find it by grepping the
  transcript.
- **Campaign facts live in the campaign repo, never here.** That covers names, the party, players,
  plot, house style and machine paths. The contract is
  `../fvtt-mcp-dnd5e/.claude/skills/_shared/campaign-repo.md`: `campaign.json` + `STYLE.md` + the
  `sessions/YYYY-MM-DD/` and `party-snapshots/` layout. Refuse to write when the live world's id
  differs from `worldId`. Snapshot only the actors listed in `party`, never `excludedActors`. Pull
  the campaign repo before reading it and push after writing.
- **The spoiler boundary is structural.** `recap.html` and the session-diary page are written only
  from what the players saw. Whispers and GM-only material can feed `recap.md` and the gm-notes,
  never the player recap.
- **The DM pastes `recap.html` into an email**, so keep its inline-style table layout (it must
  render in Gmail and Outlook). Render `recap.pdf` from `recap-print.html`, never from
  `recap.html`: Chrome splits table cells across printed pages.
- **Never persist the Craig download key.** `craig-info.json` is sanitized because session
  directories get committed. `audio/` is gitignored and stays on the processing machine.
- **The two timelines align by wall clock:** Craig's `startTime` against the epoch-ms timestamps on
  Foundry chat messages, plus `sessions.skewSeconds`. The skew measured about 0 for Craig and the
  Molten-hosted world.

## Talking to Foundry

Sister repos drive a live world through the MCP repo's library surface, not through the MCP
server and not through `dist/` paths. That surface is `fvtt-mcp-dnd5e/client` (`connectFoundry`,
`Foundry.call`, `BridgeError`, `loadEnv`), installed as a `file:../fvtt-mcp-dnd5e` dependency
with credentials read from that repo's `.env`. The contract is in the header of
`../fvtt-mcp-dnd5e/src/client.ts`, and `../fvtt-mod-battleflow/package.json` shows the dependency
setup.

Test against the local sandbox (`FOUNDRY_HOST=local`,
`node ../fvtt-mcp-dnd5e/scripts/local-foundry.mjs start|stop|status`), never prod. Run one
world-driver at a time. Tag temporary documents `ZZ-*` and delete them in `finally`.

## Family conventions (from the sister repos)

- The Node-side TypeScript repos (`fvtt-mcp-dnd5e`, `fvtt-mcp-artificer`) use Node ≥ 22, ESM,
  biome, `tsc`, vitest and knip. Their offline gate before every commit is
  `npm run check && npm run typecheck && npm test && npm run build && npm run knip`. Tests run on
  recorded fixtures or a mocked `foundry.call`, never against live APIs.
- **Tools do, skills decide.** Correctness goes in tested code: fetch, transcription, alignment,
  stat folds, file conventions. Judgment stays in a skill: recap voice, which beats are memorable,
  curation.
- Commit directly to `main`. MIT license, author Txpple, GitHub remote `Txpple/<repo>`.

## Machine gotchas carried over (Windows)

- Windows Application Control can block the DLLs of the uv-managed Python (an `_ctypes`
  ImportError). The fix is to base the venv on a signed python.org install. Never touch the
  policy itself.
- Run long transcriptions detached, with a log file. Shell background tasks time out at 10
  minutes, and `transcribe` writes its output only when it finishes.
- ctranslate2 needs the pip-installed NVIDIA `bin` directories on `PATH`; `add_dll_directory`
  alone is not enough.
- Render PDFs with headless Edge:
  `msedge.exe --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf=<out> file:///<html>`.
  A PDF of about 1 KB means the page did not load.
- Craig recordings expire after 7 days (the page says 14; the API is right). If fetching fails,
  the fallback is the zip the DM downloads: extract it into `audio/tracks/` and write
  `craig-info.json` by hand. Map speakers by Discord id, because track order differs between
  recordings, and label them with character names.

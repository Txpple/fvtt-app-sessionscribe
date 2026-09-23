# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# fvtt-app-sessionscribe

A standalone session-scribe tool for Foundry VTT (dnd5e) tables. It fetches what happened at a
session (the Craig voice recording, the Foundry chat log, Battle Flow's combat stats, the party's
sheets) and creates and manages the session record: adventure recaps, combat logs, GM notes,
party snapshots.

**State (2026-09-23): greenfield.** The directory is empty and not yet a git repo. No stack,
build, lint or test tooling has been chosen, so nothing below describes code that exists here.
The functionality is being ported in from sister repos under `D:\Workbench\FVTT\Repos\`. Until a
piece lands here, its source is the working implementation. When a piece lands, add its commands
and architecture to this file and remove its row from the table below.

## Port sources: where the functionality lives today

| Piece | Source | Notes |
| --- | --- | --- |
| The pipeline, end to end | `../fvtt-mcp-dnd5e/.claude/skills/session-scribe/SKILL.md` | The 8-step run plus the recap and combat-log house defaults. Read it in full before porting any step. |
| Fetch / transcribe / align | `…/session-scribe/scripts/session_scribe.py` | Python + faster-whisper. Subcommands `smoke`, `fetch`, `transcribe`, `align`. The header documents the Craig "ferret" API. |
| Machine bootstrap | `…/session-scribe/scripts/setup.ps1` | Installs ffmpeg and uv via winget, builds the venv at `~\.session-scribe\venv`, runs a GPU smoke test. Windows-only. |
| PDF page check | `…/session-scribe/scripts/pdf-preview.mjs` | Renders a pdf.js page grid so every page can be inspected |
| Output templates | `…/session-scribe/templates/{recap,recap-print,gm-notes,combat-log}.html` | |
| Chat log export | MCP tool `export-chat-log`: `../fvtt-mcp-dnd5e/src/tools/chat.ts`, `src/utils/transcript.ts` | |
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

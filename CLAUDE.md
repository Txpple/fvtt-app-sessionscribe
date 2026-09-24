# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# fvtt-app-sessionscribe

The home of **session summaries and analytics** for Foundry VTT (dnd5e) tables: an MCP server
(registered at user scope as `scribe`) plus the `session-scribe` skill. It reads what happened at
a session and writes the session record into the campaign repo:
- **Inputs:** the Craig voice recording, the Foundry chat log, Battle Flow's combat stats, the
  party's sheets.
- **Record:** transcripts, recaps, combat logs, GM notes, party snapshots.

It **reads the world and never writes it**. The session-diary page and the bestiary are authored
through `fvtt-mcp-dnd5e`.

**State (2026-09-23).** Read [NEXT-SESSION.md](NEXT-SESSION.md) first: it is the handoff, the
work left in order with its gates. Broken out of `fvtt-mcp-dnd5e` by owner ruling (reversing
that repo's 3.0 decisions #16 and #17). All eight tools and the skill have landed.
- **Proven:**
  - build-transcript: parity on the 9 real sessions.
  - fetch-recording: the real 2026-09-22 zip.
  - transcribe-recording: on CUDA, resume included.
  - render-pdf: 2026-09-22's four PDFs.
- **Proven live on the sandbox, as Scribe Assistant:**
  - the reader's gate `scripts/verify-reader.mjs`;
  - the parity runs `scripts/parity-{combat,chat,snapshot}.mjs`.
- **Next:** the MCP's copies are retired (its 4.0.0: `get-combat-stats`, the `session-scribe`
  skill), and Battle Flow and the campaign repo get their doc pointers.

Until the retirement, `fvtt-mcp-dnd5e` still carries the old `session-scribe` skill and
`get-combat-stats`. `export-chat-log` stays there for good as the general chat exporter.

## Commands

```bash
npm install                 # once; fvtt-mcp-dnd5e must be built first (its dist/ is the client)
npm run build               # tsc → dist/, then esbuild.page.mjs → dist/page.bundle.js
npm test                    # vitest, offline (src/**/*.test.ts)
npx vitest run src/transcript/align.test.ts   # one file; add -t "<name>" for one test
npm run check && npm run typecheck && npm test && npm run build && npm run knip   # the gate
node scripts/parity-transcript.mjs                  # offline, against the real sessions
FOUNDRY_HOST=local node scripts/parity-combat.mjs   # sandbox only (also parity-chat, parity-snapshot)
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -PrefetchModel   # transcription venv
```

- **Every commit:** run the gate first. `npm run check:fix` applies biome's formatting.
- **The server runs from `dist/`,** so rebuild after a change. A new or renamed tool needs a
  Claude Code restart, which only the owner can do.

## Architecture

**The server**
- `src/index.ts` (stdio) runs `src/server.ts`, which is transport-agnostic; the tests drive it
  with an in-memory client.
- `src/registry.ts` is the one name → handler map. The advertised list is derived from it, and a
  mismatch fails fast.
- Each tool is a class in `src/tools/` with a hoisted zod schema; `src/utils/schema.ts` generates
  the JSON Schema. Keep the family's prose budget: a description ≤ 400 chars, a leaf
  `.describe()` ≤ 120.

**Config and the record**
- `src/config.ts` reads this repo's `.env` once. Foundry host URLs and the admin key are not
  here; they come from `fvtt-mcp-dnd5e`'s `.env` through its client.
- `src/campaign.ts` enforces `campaign.json`. `resolveSessionDir` is the one way a `date` becomes
  a session directory.
- `src/record.ts` measures a session against today's `sessions.outputs`.

**Foundry reads never run in the server**
- `src/foundry/read.ts` spawns `src/workers/foundry-read.ts` per read: request on stdin, one
  sentinel-prefixed reply line on stdout, killed after its watchdog.
- The worker uses `src/foundry/session.ts`, shared with the parity scripts:
  - It joins as **Scribe Assistant** (never the MCP bridge's user: two clients on one user double
    Battle Flow's automation), with the admin key stripped.
  - It injects `dist/page.bundle.js` as `window.__scribe`.
  - It probes the world, and `protocol.refusal()` refuses another world, a login below Assistant
    GM, or the scribe being the elected GM while a combat runs.
- The page ops (`src/page/*.ts`) are browser-only and answer JSON strings.
  - Watch for `Set`s: the JSON boundary flattens them to `{}`.

**Long steps are detached jobs**
- `src/jobs.ts`: the stdio of every job goes to `<session>/audio/.jobs/<kind>.log`, never the
  MCP's stdout.
- The worker keeps its own status file. Secrets travel in the worker's env only.
- The workers:
  - `src/workers/fetch-recording.ts` runs `src/fetch.ts` and `src/craig.ts`.
  - `worker/transcribe.py` is faster-whisper, the only Python.
- `scribe-status { date, waitSeconds }` follows a job.

**The ports**
- `src/analytics/combat.ts` and `src/page/combat-stats.ts` are verbatim copies of the MCP's
  `get-combat-stats`. Keep them diffable until the retirement.
- `src/transcript/align.ts` is `session_scribe.py align` line for line, plus the whisper fix and
  `transcript-public.md`.
- `src/pdf.ts` prints with headless Edge.

**The skill:** `.claude/skills/session-scribe/`, with its templates. It is junctioned to
`~/.claude/skills/session-scribe`, so it loads in any project.

**Test fixtures are synthetic** (`src/testing/`). No campaign fact belongs in this repo.

## Invariants

- **The DM does four things:** `/join` Craig, play, `/stop`, paste the link. Never ask them to
  mark, export or download anything; a spoken "mark that" is found by grepping the transcript.
- **Campaign facts live in the campaign repo, never here.** That covers names, the party,
  players, plot, house style and machine paths.
  - The contract is `../fvtt-mcp-dnd5e/.claude/skills/_shared/campaign-repo.md`.
  - The record layout is `sessions/YYYY-MM-DD/` and `party-snapshots/`; `session-audit` and
    `bestiary-builder` read it, so don't change it.
- **The spoiler boundary is a file.**
  - `transcript-public.md` withholds every whisper and blind roll.
  - `recap.html` and the session-diary page are written from it.
  - `transcript.md` (🤫 marked) may feed only `recap.md` and the GM notes.
- **`recap.html` is pasted into email**, so keep its inline-style table layout. `recap.pdf`
  prints from `recap-print.html`, never `recap.html`.
- **The Craig key is never persisted:** `craig-info.json` is sanitized. `audio/` is gitignored:
  the tracks, the job files, the PDF previews.
- **Timelines align by wall clock:** Craig's `startTime` vs the epoch-ms chat timestamps, plus
  `sessions.skewSeconds` (≈ 0 measured).

## Live checks

- **Sandbox only** (`FOUNDRY_HOST=local`), never prod.
- **One world-driver at a time.** Before a run:
  - check `node ../fvtt-mcp-dnd5e/scripts/local-foundry.mjs status`;
  - check that no Battle Flow suite (`tools/*.mjs`) is running.
  - Other sessions run those suites as Tester Assistant. The scribe must never borrow that
    identity.
- **Replays of real sessions** go to a scratch copy of the campaign repo (point
  `SCRIBE_CAMPAIGN_REPO` at it), never the real one.

## Family conventions (from the sister repos)

- Node ≥ 22, ESM, biome, `tsc`, vitest, knip. Tests run on fakes: injected HTTP, exec and world
  reader; never live APIs.
- **Tools do, skills decide.** Correctness goes in tested code; judgment (recap voice, which beats
  are memorable, curation) stays in the skill.
- Commit directly to `main` and push. MIT license, author Txpple. The remote is
  `Txpple/fvtt-app-sessionscribe`, created **private** (the tool siblings are public; flipping
  it is the owner's call).

## Machine gotchas (Windows)

- **msedge.exe is a launcher:** it exits in about 50 ms and a child process writes the PDF
  seconds later. `src/pdf.ts` waits for the file to settle. A PDF of about 1 KB means the page
  did not load.
- **Windows Application Control can block the uv-managed Python's DLLs** (an `_ctypes`
  ImportError). The fix is a venv on a signed python.org install. Never touch the policy itself.
- **ctranslate2 needs the pip-installed NVIDIA `bin` directories on `PATH`;**
  `add_dll_directory` alone is not enough. The worker handles it.
- **Python on Windows writes text files as CRLF,** and the port writes LF. Compare line by line
  with `\r?\n`.
- **Craig recordings expire after 7 days** (the page says 14; the API is right). The DM's own
  zip is `fetch-recording { zipPath }`, with speakers mapped by Discord id: track order differs
  per recording.

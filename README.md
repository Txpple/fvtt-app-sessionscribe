# fvtt-app-sessionscribe

An [MCP](https://modelcontextprotocol.io) server and a [Claude Code](https://claude.com/claude-code)
skill that turn a night at a **D&D 5e** [Foundry VTT](https://foundryvtt.com) table into its
session record. It reads four inputs: the [Craig](https://craig.chat) recording from Discord, the
Foundry chat log, [Battle Flow](https://github.com/Txpple/fvtt-mod-battleflow)'s combat stats and
the party's sheets. From them it writes a speaker-labelled transcript, a player recap (email and
PDF), a combat report, GM notes and a party snapshot into your campaign repo.

It **reads the world and never writes it**. The session-diary page goes in through the sibling
[`fvtt-mcp-dnd5e`](https://github.com/Txpple/fvtt-mcp-dnd5e).

**At the table, the DM does four things:** `/join` Craig, play, `/stop`, and paste the link to
Claude. There is nothing to mark, export or download. A "mark that" said aloud is found in the
transcript.

## Setup

```bash
git clone https://github.com/Txpple/fvtt-app-sessionscribe && cd fvtt-app-sessionscribe
npm install && npm run build      # fvtt-mcp-dnd5e must be cloned beside this repo and built first
cp .env.example .env              # FOUNDRY_SCRIBE_USER / FOUNDRY_SCRIBE_PASSWORD, SCRIBE_CAMPAIGN_REPO
claude mcp add -s user scribe -e FOUNDRY_HOST=molten -- node /absolute/path/to/fvtt-app-sessionscribe/dist/index.js
```

Then, once per machine:

- **Transcription toolchain.** Run `powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -PrefetchModel`.
  It installs ffmpeg, builds a Python venv with faster-whisper and the CUDA wheels, and runs a
  smoke test. It is idempotent.
- **The skill, in every project.** From the repo root in PowerShell, run
  `New-Item -ItemType Junction -Path "$HOME\.claude\skills\session-scribe" -Target "$PWD\.claude\skills\session-scribe"`.
- **The scribe's own Foundry user.** Create an Assistant GM user (default `Scribe Assistant`).
  Don't reuse the MCP's user: two clients on one user double Battle Flow's automation.
- **Restart Claude Code** and ask for `scribe-status`, which reports anything missing.

`FOUNDRY_HOST` is `molten` or `local`. It sets the default host for reads, and each read tool
can override it per call. The host URLs come from `fvtt-mcp-dnd5e`'s `.env`, not this repo's.

**Requirements:**
- Windows and Node.js 22+.
- `fvtt-mcp-dnd5e`, built, beside this repo.
- Microsoft Edge, for the PDFs.
- An NVIDIA GPU for transcription. The CPU works, but slower.
- A dnd5e world. Battle Flow is needed only for the combat report.
- The Craig bot in your Discord server.
- A campaign repo: `campaign.json` + `STYLE.md`, as described in
  [`campaign-repo.md`](https://github.com/Txpple/fvtt-mcp-dnd5e/blob/main/.claude/skills/_shared/campaign-repo.md).

## The skill

Paste a Craig link, or say **"process the session"**. The `session-scribe` skill runs the
pipeline in this order:
1. Check, fetch and transcribe.
2. Export the chat log, build the transcript and analyse the combat.
3. Write the recap, the combat log and the GM notes.
4. Render the PDFs and look at every page.
5. Snapshot the party and add the session-diary page.
6. Commit to the campaign repo.

The tools handle correctness and the skill handles judgment: the recap's voice, which beats
matter, and the illustrations, which it makes with
[`fvtt-app-artificer`](https://github.com/Txpple/fvtt-app-artificer)'s `illustration-builder`.

## Tools

| Tool | Does |
| --- | --- |
| `scribe-status` | checks health (Python + CUDA, ffmpeg, Edge, the campaign repo, the login; `connect: true` proves the login), shows what each session has, and follows a job with `date` + `waitSeconds` |
| `fetch-recording` | turns the Craig link (or the DM's own flac zip) into one track per speaker, labelled by Discord id. Runs as a job |
| `transcribe-recording` | runs faster-whisper on each track → `transcript-segments.json`. Runs as a job and resumes after a crash |
| `export-session-chat` | exports the recording window's chat log → `chatlog.json`, with whispers and blind rolls marked |
| `build-transcript` | merges speech and chat by wall clock → `transcript.md` and `transcript-public.md` (whispers withheld) |
| `analyze-combat` | turns Battle Flow's stat stamps into per-combat damage, accuracy, healing, spends and moments |
| `snapshot-party` | exports the party's sheets in full (restorable with Import Data), plus the digest facts |
| `render-pdf` | prints the outputs' HTML to PDF with headless Edge, and saves every page as a JPEG to check |

## The record

The record goes into the campaign repo, under `sessions/YYYY-MM-DD/` and `party-snapshots/`.
`campaign.json`'s `sessions.outputs` picks which documents a session gets.

**The spoiler boundary is a file.**
- `transcript-public.md` withholds every whisper and blind roll. The player recap and the
  session-diary page are written from it alone.
- `transcript.md`, where whispers are marked 🤫, feeds only the GM's documents.

The audio, the job logs and the page previews stay in the session's `audio/`, which is
gitignored. The Craig key is never saved.

## How it works

- **Joining Foundry.** Each Foundry read runs in its own child process through `fvtt-mcp-dnd5e`'s
  headless-Chromium client, joined as the scribe's user. It refuses to read in three cases:
  another world, a login below Assistant GM, or the scribe being the elected GM while a combat
  runs.
- **Long steps.** Fetching and transcribing are detached jobs that log to the session's
  `audio/.jobs/`, so they never block the server.
- **Timing.** Speech and chat are aligned by wall clock: Craig's `startTime` against Foundry's
  epoch-ms timestamps. There are no markers and no sync step.

## Development

The offline gate is `npm run check && npm run typecheck && npm test && npm run build && npm run knip`.
The tests run on fakes, never on live APIs. `node scripts/call.mjs <tool> '<json>'` runs one tool
through a fresh `dist/index.js`.

The live checks run on a sandbox only:
- `FOUNDRY_HOST=local node scripts/verify-reader.mjs` proves that the reader leaves no trace.
- `parity-chat.mjs` and `parity-snapshot.mjs` compare the output with the MCP's exporters.

## License

MIT — see [LICENSE](LICENSE).

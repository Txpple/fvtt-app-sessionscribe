# Changelog

What changed for a user of the tools and the skill, release by release. Dates are tag dates.

## Unreleased

- **The server key is `sessionscribe`** (was `scribe`), the repo's name part, as
  `fvtt-mcp-imagegen` registers as `imagegen`. Tools now appear as `mcp__sessionscribe__*`; the
  tool names themselves (`scribe-status`, `fetch-recording`, ...) and the env names
  (`SCRIBE_CAMPAIGN_REPO`, `FOUNDRY_SCRIBE_USER`, ...) are unchanged. **Rename your
  registration:** `claude mcp remove -s user scribe`, then
  `claude mcp add -s user sessionscribe ...` (or rename the `scribe` key under `mcpServers` in
  `~/.claude.json`), and restart Claude Code. Anything that names `mcp__scribe__*` tools (a
  permission allowlist, a campaign repo's notes) needs the same edit. Log lines read
  `[sessionscribe]`.
- The description says what it is: an MCP server (it was "an app" since the `fvtt-app-*` days).

## 1.0.0 — 2026-09-30 — the scribe, proven on a full campaign

The first release. Everything below landed between 2026-09-23 and 2026-09-26 and was proven
on the Greenrest campaign's last two sessions: session 8 replayed end to end from its Craig
link into a scratch clone (2026-09-24), and session 9, the finale, processed for real
(2026-09-29).

**The app** (broken out of `fvtt-mcp-dnd5e` by the owner's ruling of 2026-09-23, reversing
that repo's 3.0 decisions #16 and #17; the MCP retired its copies in its 4.0.0):
- Eight tools, driven by Claude Code through the `scribe` MCP server:
  - `scribe-status`: health, the record's completeness against `campaign.json`, and following a
    detached job.
  - `fetch-recording`: the Craig recording from its link (cook, download, extract) or from the
    DM's own zip, speakers mapped by Discord id. A detached job; the Craig key is never
    persisted.
  - `transcribe-recording`: faster-whisper on CUDA, the one Python step, resumable.
  - `build-transcript`: the retired `session_scribe.py align` ported line for line, with the
    whisper fix and `transcript-public.md` (the spoiler-free transcript the recap is written
    from). Parity on the 9 real sessions.
  - `export-session-chat`: the night's chat log into `chatlog.json`, visibility spelled out.
    Parity with the MCP's `export-chat-log`.
  - `analyze-combat`: the MCP's `get-combat-stats` ported verbatim and scoped to the session's
    window, then extended: Battle Flow's 2026-09 stamp families (reminders, chips, wards,
    maneuvers, clock riders, emanations), an arithmetic "traits denied" meter, and the fighting
    styles tallied per attacker. Parity with the MCP on 10/10 windows before it evolved.
  - `snapshot-party`: the party's sheets at the wrap, byte-compatible with `manage-actors
    export`, with digests of limited-use features and active effects.
  - `render-pdf`: the session's PDFs printed with headless Edge from their print sources, page
    counts checked, and every page rasterised to `audio/previews/` for review.
- **The Foundry reader** joins as the scribe's own **Scribe Assistant** user, injects its own
  page bundle, and never writes the world. It refuses another world, a login below Assistant
  GM, or being the elected GM while a combat runs. Every read runs in a one-shot child with a
  watchdog. `scripts/verify-reader.mjs` proves it leaves no trace.
- **Long steps are detached jobs** with their own logs under `<session>/audio/.jobs/`.
- **The `session-scribe` skill**, rewritten to these tools, with the recap, combat-log and
  GM-notes templates. Print keeps use `display: flow-root`, the only keep Chromium honours.
- **The record** is written to the campaign repo (`sessions/YYYY-MM-DD/`, `party-snapshots/`),
  per `fvtt-mcp-dnd5e`'s campaign-repo contract. No campaign fact lives in this repo.

**Verified** (2026-09-30): biome · `tsc --noEmit` · vitest 21 files, 128 tests · build · knip.
Live on the sandbox (2026-09-23): reader 4/4, parity 10/10 combat windows, 10/10 chat windows,
4/4 party snapshots byte-identical.

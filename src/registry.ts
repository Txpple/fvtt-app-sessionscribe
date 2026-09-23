// The tool registry: the single place tool names, definitions and handlers are wired together
// (the family pattern, from fvtt-mcp-dnd5e by way of the artificer). The `handlers` map is the
// source of truth; the advertised `tools` list is DERIVED from it, so the two cannot drift, and a
// handler without a matching definition fails fast at startup.

import { AnalyzeCombatTool } from './tools/analyze-combat.js';
import { BuildTranscriptTool } from './tools/build-transcript.js';
import { ExportSessionChatTool } from './tools/export-session-chat.js';
import { FetchRecordingTool } from './tools/fetch-recording.js';
import { RenderPdfTool } from './tools/render-pdf.js';
import { SnapshotPartyTool } from './tools/snapshot-party.js';
import { type StatusDeps, StatusTool } from './tools/status.js';
import { TranscribeRecordingTool } from './tools/transcribe-recording.js';

export type ToolDeps = StatusDeps;

export interface ToolRegistry {
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
  handlers: Record<string, (args: unknown) => Promise<unknown>>;
  dispatch(name: string, args: unknown): Promise<unknown>;
}

export function buildToolRegistry(deps: ToolDeps): ToolRegistry {
  const status = new StatusTool(deps);
  const combat = new AnalyzeCombatTool(deps);
  const snapshot = new SnapshotPartyTool(deps);
  const pdf = new RenderPdfTool(deps);
  const fetchRec = new FetchRecordingTool(deps);
  const transcribe = new TranscribeRecordingTool(deps);
  const chat = new ExportSessionChatTool(deps);
  const transcript = new BuildTranscriptTool(deps);

  const handlers: ToolRegistry['handlers'] = {
    'scribe-status': args => status.handleStatus(args),
    'fetch-recording': args => fetchRec.handleFetchRecording(args),
    'transcribe-recording': args => transcribe.handleTranscribeRecording(args),
    'export-session-chat': args => chat.handleExportSessionChat(args),
    'build-transcript': args => transcript.handleBuildTranscript(args),
    'analyze-combat': args => combat.handleAnalyzeCombat(args),
    'snapshot-party': args => snapshot.handleSnapshotParty(args),
    'render-pdf': args => pdf.handleRenderPdf(args),
  };

  const definitions = [
    ...status.getToolDefinitions(),
    ...fetchRec.getToolDefinitions(),
    ...transcribe.getToolDefinitions(),
    ...chat.getToolDefinitions(),
    ...transcript.getToolDefinitions(),
    ...combat.getToolDefinitions(),
    ...snapshot.getToolDefinitions(),
    ...pdf.getToolDefinitions(),
  ];

  const tools = Object.keys(handlers).map(name => {
    const def = definitions.find(d => d.name === name);
    if (!def) throw new Error(`handler ${name} has no advertised tool definition`);
    return def;
  });
  for (const def of definitions) {
    if (!(def.name in handlers)) throw new Error(`definition ${def.name} has no handler`);
  }

  return {
    tools,
    handlers,
    dispatch(name, args) {
      const handler = handlers[name];
      if (!handler) return Promise.reject(new Error(`Unknown tool: ${name}`));
      return handler(args);
    },
  };
}

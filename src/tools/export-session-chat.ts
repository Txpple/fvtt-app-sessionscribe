// export-session-chat: the night's chat log into the session record as chatlog.json, the
// mechanics half of the transcript (every roll, whisper and card, each with an epoch-ms
// timestamp). Scoped to the recording window unless told otherwise; JSON only, local files only.
// The general multi-format "save the chat log" stays fvtt-mcp-dnd5e's export-chat-log.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { loadCampaign, resolveSessionDir } from '../campaign.js';
import type { Config } from '../config.js';
import type { WorldReader } from '../foundry/read.js';
import type { ChatRecord } from '../page/chat.js';
import { toInputSchema } from '../utils/schema.js';
import { describeWindow, resolveWindow } from '../window.js';
import { hostSchema } from './status.js';

export const CHATLOG = 'chatlog.json';

const ExportSessionChatSchema = z.object({
  date: z
    .string()
    .describe('The session (YYYY-MM-DD or its directory name); needs craig-info.json.'),
  since: z
    .string()
    .optional()
    .describe('Start, ISO date or epoch ms; overrides the session window.'),
  until: z.string().optional().describe('End, ISO date or epoch ms; overrides the session window.'),
  overwrite: z.boolean().default(false).describe('Replace an existing chatlog.json.'),
  host: hostSchema,
});

export interface ExportSessionChatDeps {
  config: Config;
  reader: WorldReader;
}

export class ExportSessionChatTool {
  constructor(private readonly deps: ExportSessionChatDeps) {}

  getToolDefinitions() {
    return [
      {
        name: 'export-session-chat',
        description:
          "Write a session's Foundry chat log to its chatlog.json: every message in the " +
          'recording window (padded 10 min), with rolls, and whisper / blind visibility spelled ' +
          'out (whisper, whisperTo). The input build-transcript aligns with the speech.',
        inputSchema: toInputSchema(ExportSessionChatSchema),
      },
    ];
  }

  async handleExportSessionChat(args: unknown) {
    const p = ExportSessionChatSchema.parse(args ?? {});
    const campaign = loadCampaign(this.deps.config.campaignRepo);
    const sessionDir = resolveSessionDir(campaign, p.date);
    const file = path.join(sessionDir, CHATLOG);
    if (fs.existsSync(file) && !p.overwrite) {
      throw new Error(`${file} exists; pass overwrite: true to replace it`);
    }
    const window = resolveWindow({ sessionDir, since: p.since, until: p.until });
    const host = p.host ?? this.deps.config.defaultHost;
    const r = await this.deps.reader<{ totalMessages: number; records: ChatRecord[] }>({
      op: 'scanSessionChat',
      args: { since: window.since, ...(window.until !== undefined ? { until: window.until } : {}) },
      host,
      worldId: campaign.worldId,
    });
    if (!r.ok || !r.result) throw new Error(r.error ?? 'the reader returned no messages');
    const { records, totalMessages } = r.result;
    fs.writeFileSync(file, JSON.stringify(records, null, 2));
    return {
      file,
      host,
      readAt: r.readAt,
      window: describeWindow(window),
      messages: records.length,
      ofTotal: totalMessages,
      rolls: records.filter(m => m.isRoll).length,
      whispered: records.filter(m => m.whisper).length,
      blind: records.filter(m => m.blind).length,
    };
  }
}

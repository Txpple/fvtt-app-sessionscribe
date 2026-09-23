// Page-side: the session's chat log, as the record the transcript is built from. Read-only.
//
// The record is fvtt-mcp-dnd5e's export-chat-log JSON record (src/page/chat.ts rawFields +
// chat-helpers.ts toMessageRecord, contentMode 'text'), field for field, so the nine chatlog.json
// files written before the break-out still read the same. What it adds is VISIBILITY, explicitly:
// that record only ever carried `whisperCount`, and the transcript builder read a `whisper` field
// it never had, so every whisper went into the transcript as public chat. Here:
//   whisper      true when the message had any whisper recipient (incl. a GM roll to self)
//   whisperTo    the recipients' user names
//   blind        a blind roll (the roller did not see it)
// Whisper-ness derives from the `whisper` id array on Foundry 14 (there is no WHISPER style).

export interface ChatRecord {
  id: string;
  author: string;
  authorName?: string;
  alias?: string;
  timestamp: number;
  time: string;
  style: number;
  isRoll: boolean;
  whisperCount: number;
  whisper: boolean;
  whisperTo?: string[];
  blind: boolean;
  /** Plain text (HTML stripped); always present, possibly empty, as in the MCP record. */
  content: string;
  title?: string;
  flavor?: string;
  rolls?: Array<{ total?: number; formula?: string }>;
}

export interface ScanSessionChatArgs {
  since?: number | undefined;
  until?: number | undefined;
}

/** Strip HTML to plain text using a detached element (browser-only). */
function stripHtml(html: string): string {
  const el = document.createElement('div');
  el.innerHTML = html ?? '';
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * dnd5e 6.0 creates activity / roll cards with NO `content`: the card renders at display time from
 * `message.system` (a data model with an async `render()`). Empty when it has no template.
 */
async function renderSystemContent(m: any): Promise<string> {
  if (typeof m?.system?.render !== 'function') return '';
  try {
    const html = await m.system.render({});
    return typeof html === 'string' ? html : '';
  } catch {
    return '';
  }
}

export async function toChatRecord(m: any): Promise<ChatRecord> {
  const author = typeof m.author === 'string' ? m.author : (m.author?.id ?? '');
  const authorName =
    (typeof m.author === 'object' ? m.author?.name : undefined) ??
    game.users?.get(author)?.name ??
    '';
  const whisperIds: string[] = Array.isArray(m.whisper)
    ? m.whisper.map((w: any) => (typeof w === 'string' ? w : (w?.id ?? '')))
    : [];
  const timestamp = m.timestamp ?? 0;
  const alias = m.speaker?.alias ?? m.alias ?? '';
  const isRoll = Boolean(m.isRoll);
  const rolls =
    isRoll && Array.isArray(m.rolls) && m.rolls.length
      ? m.rolls.map((r: any) => {
          const o: { total?: number; formula?: string } = {};
          if (typeof r?.total === 'number') o.total = r.total;
          const f = r?.formula ?? r?._formula;
          if (typeof f === 'string') o.formula = f;
          return o;
        })
      : null;
  // Key order follows the MCP record's, so an old and a new chatlog.json diff cleanly.
  return {
    id: m.id ?? '',
    author,
    timestamp,
    time: new Date(timestamp).toISOString(),
    style: m.style ?? 0,
    isRoll,
    whisperCount: whisperIds.length,
    blind: Boolean(m.blind),
    whisper: whisperIds.length > 0,
    ...(whisperIds.length
      ? { whisperTo: whisperIds.map(id => game.users?.get(id)?.name ?? id) }
      : {}),
    ...(authorName ? { authorName } : {}),
    ...(alias ? { alias } : {}),
    content: stripHtml(m.content || (await renderSystemContent(m))),
    ...(m.title ? { title: m.title } : {}),
    ...(m.flavor ? { flavor: m.flavor } : {}),
    ...(rolls ? { rolls } : {}),
  };
}

/** Every message in [since, until], oldest first. */
export async function scanSessionChat(args: ScanSessionChatArgs = {}) {
  const since = Number(args.since) || 0;
  const until = Number(args.until) || Number.POSITIVE_INFINITY;
  const msgs = (game.messages?.contents ?? [])
    .filter((m: any) => (m.timestamp ?? 0) >= since && (m.timestamp ?? 0) <= until)
    .sort((a: any, b: any) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  const records: ChatRecord[] = [];
  for (const m of msgs) records.push(await toChatRecord(m));
  return { totalMessages: game.messages?.size ?? 0, records };
}

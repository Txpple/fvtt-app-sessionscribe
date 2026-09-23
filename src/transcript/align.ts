// The transcript: speech paragraphs from the per-speaker Whisper segments, interleaved by wall
// clock with the Foundry chat log's rolls, chat and whispers. Ported from session_scribe.py's
// `align` (fvtt-mcp-dnd5e, retired by the 2026-09-23 break-out) line for line, with one fix and
// one addition:
//
//   FIX: whispers were never tagged. `align` read a `whisper` field the chat export never wrote
//        (it has `whisperCount`), and its roll branch ignored visibility altogether, so every
//        whispered message and GM roll landed in the transcript as public 💬 / 🎲. Now any
//        message with a recipient, or a blind roll, is 🤫, chat and rolls alike.
//   ADD: transcript-public.md, the same timeline with every 🤫 event withheld: the file the
//        player recap and the session-diary page are written from, so the spoiler boundary is a
//        file, not a judgment call.
//
// Everything else reproduces the Python byte for byte (scripts/parity-transcript.mjs proves it on
// the real sessions): paragraphs merge a speaker's segments across gaps ≤ 2.5 s up to
// maxParagraphSeconds; chat events are kept within the recording ±120 s; long card text is cut
// to 200 characters.

export interface CraigInfo {
  startTime: string;
  durationSeconds?: number | null;
  guild?: string | null;
  channel?: string | null;
  craigNotes?: unknown;
}

export interface Segments {
  model?: string | null;
  device?: string | null;
  tracks: Array<{
    file?: string;
    speaker: string;
    segments: Array<{ start: number; end: number; text: string }>;
  }>;
}

/** A chatlog.json record: the MCP's export record, or the scribe's (which adds whisper/whisperTo). */
export interface ChatLogRecord {
  timestamp?: number;
  isRoll?: boolean;
  rolls?: Array<{ formula?: string | null; total?: number | null }> | null;
  alias?: string | null;
  authorName?: string | null;
  flavor?: string | null;
  content?: string | null;
  whisper?: boolean | string[] | null;
  whisperCount?: number;
  whisperTo?: string[];
  blind?: boolean;
}

export interface AlignOptions {
  skewSeconds: number;
  maxParagraphSeconds: number;
  /** Keep chat events outside the recording window. */
  noWindow: boolean;
}

export const DEFAULT_ALIGN: AlignOptions = {
  skewSeconds: 0,
  maxParagraphSeconds: 75,
  noWindow: false,
};

type Kind = 'speech' | 'roll' | 'chat' | 'whisper';
interface Event {
  t: number;
  kind: Kind;
  text: string;
  speaker?: string;
  end?: number;
}

const ICON: Record<Exclude<Kind, 'speech'>, string> = { roll: '🎲', chat: '💬', whisper: '🤫' };

// Python's html.unescape for what a chat log carries; numeric references in full.
const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: String.fromCharCode(0xa0),
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  times: '×',
  minus: '−',
  bull: '•',
  middot: '·',
  deg: '°',
};

export function unescapeHtml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === '#') {
      const code =
        ref[1] === 'x' || ref[1] === 'X' ? Number.parseInt(ref.slice(2), 16) : Number(ref.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED[ref] ?? whole;
  });
}

export function stripHtml(s: string): string {
  return unescapeHtml(s.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** HH:MM:SS, floored, never negative (Python's `max(0, int(seconds))`). */
export function hms(seconds: number): string {
  const s = Math.max(0, Math.trunc(seconds));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** Python's str() of an optional value inside an f-string: None prints as "None". */
const py = (v: unknown): string => (v === null || v === undefined ? 'None' : String(v));

/** Whether a record was not public at the table: any whisper recipient, or a blind roll. */
export function isWhispered(m: ChatLogRecord): boolean {
  if (m.blind) return true;
  if (m.whisper === true) return true;
  if (Array.isArray(m.whisper) && m.whisper.length > 0) return true;
  return (m.whisperCount ?? 0) > 0;
}

function speakerOf(m: ChatLogRecord): string {
  return py(m.alias || m.authorName || null);
}

export interface Transcripts {
  full: string;
  public: string;
  stats: {
    speechParagraphs: number;
    chatEvents: number;
    outsideWindow: number;
    whispered: number;
  };
}

export function buildTranscripts(
  meta: CraigInfo,
  segs: Segments,
  chat: ChatLogRecord[],
  opts: AlignOptions = DEFAULT_ALIGN
): Transcripts {
  const t0 = Date.parse(meta.startTime) / 1000;
  const duration = Number(meta.durationSeconds || 0);

  const events: Event[] = [];
  for (const track of segs.tracks) {
    let para: Event | null = null;
    for (const s of track.segments) {
      if (para && s.start - (para.end ?? 0) <= 2.5 && s.end - para.t <= opts.maxParagraphSeconds) {
        para.text += ` ${s.text}`;
        para.end = s.end;
      } else {
        if (para) events.push(para);
        para = { t: s.start, end: s.end, kind: 'speech', speaker: track.speaker, text: s.text };
      }
    }
    if (para) events.push(para);
  }

  const lo = t0 - 120;
  const hi = t0 + Math.max(duration, 1) + 120;
  let kept = 0;
  let skipped = 0;
  let whispered = 0;
  for (const m of chat) {
    const t = (m.timestamp ?? 0) / 1000 + opts.skewSeconds;
    if (!(lo <= t && t <= hi) && !opts.noWindow) {
      skipped++;
      continue;
    }
    kept++;
    const secret = isWhispered(m);
    if (secret) whispered++;
    const to = secret && m.whisperTo?.length ? ` (to ${m.whisperTo.join(', ')})` : '';
    const rolls = m.rolls ?? [];
    let text: string;
    let kind: Kind;
    if (m.isRoll && rolls.length) {
      const parts = rolls.map(
        r =>
          `${r.formula === undefined ? '?' : py(r.formula)} = ${r.total === undefined ? '?' : py(r.total)}`
      );
      text = `${speakerOf(m)}${to} — ${stripHtml(m.flavor || '') || 'roll'}: ${parts.join(', ')}`;
      kind = secret ? 'whisper' : 'roll';
    } else {
      let body = stripHtml(m.content || '');
      // dnd5e item/spell cards carry their full rules text; keep the headline only.
      const chars = Array.from(body);
      if (chars.length > 200) body = `${chars.slice(0, 200).join('').trimEnd()} …`;
      text = `${speakerOf(m)}${to}: ${body}`;
      kind = secret ? 'whisper' : 'chat';
    }
    events.push({ t: t - t0, kind, text });
  }

  events.sort((a, b) => a.t - b.t);

  const skew = opts.skewSeconds
    ? `, skew ${opts.skewSeconds >= 0 ? '+' : ''}${opts.skewSeconds.toFixed(1)}s applied`
    : '';
  const header = (title: string, chatLine: string): string[] => [
    `# ${title} — ${meta.guild ?? '?'} / #${meta.channel ?? '?'}`,
    '',
    `- **Recorded:** ${meta.startTime} (${hms(duration)} long)`,
    `- **Model:** ${py(segs.model)} on ${py(segs.device)}`,
    `- **Chat events:** ${chatLine}${skew}`,
    '',
    '---',
    '',
  ];
  const line = (e: Event): string =>
    e.kind === 'speech'
      ? `**[${hms(e.t)}] ${e.speaker}:** ${e.text}`
      : `> ${ICON[e.kind]} \`[${hms(e.t)}]\` ${e.text}`;
  const render = (lines: string[], evs: Event[]): string => {
    for (const e of evs) lines.push(line(e), '');
    return lines.join('\n');
  };

  const full = render(
    header('Session transcript', `${kept} in window, ${skipped} outside`),
    events
  );
  const pub = render(
    [
      ...header(
        'Public transcript',
        `${kept - whispered} in window (${whispered} whispered or blind withheld), ${skipped} outside`
      ).slice(0, 5),
      '',
      '> What the table heard and saw: whispers and blind rolls are withheld. Write the player',
      '> recap and the session-diary page from this file.',
      '',
      '---',
      '',
    ],
    events.filter(e => e.kind !== 'whisper')
  );
  return {
    full,
    public: pub,
    stats: {
      speechParagraphs: events.filter(e => e.kind === 'speech').length,
      chatEvents: kept,
      outsideWindow: skipped,
      whispered,
    },
  };
}

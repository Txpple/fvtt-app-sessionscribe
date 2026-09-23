import { describe, expect, it } from 'vitest';
import {
  buildTranscripts,
  type ChatLogRecord,
  type CraigInfo,
  hms,
  isWhispered,
  type Segments,
  stripHtml,
  unescapeHtml,
} from './align.js';

const START = '2026-01-06T23:00:00.000Z';
const T0 = Date.parse(START);
const META: CraigInfo = {
  startTime: START,
  durationSeconds: 3600,
  guild: 'Guild',
  channel: 'voice',
};
const at = (s: number) => T0 + s * 1000;

const SEGS: Segments = {
  model: 'large-v3-turbo',
  device: 'cuda/float16',
  tracks: [
    {
      speaker: 'Aldric Stone',
      segments: [
        { start: 10, end: 12, text: 'I open the door.' },
        { start: 13, end: 15, text: 'Carefully.' }, // gap 1 s: same paragraph
        { start: 30, end: 31, text: 'Anyone there?' }, // gap 15 s: new paragraph
      ],
    },
    { speaker: 'Gamemaster', segments: [{ start: 20, end: 25, text: 'A goblin leaps out!' }] },
  ],
};

const CHAT: ChatLogRecord[] = [
  {
    timestamp: at(21),
    isRoll: true,
    alias: 'Goblin',
    flavor: 'Stealth',
    rolls: [{ formula: '1d20 + 6', total: 17 }],
  },
  { timestamp: at(22), alias: 'Aldric Stone', content: '<p>I draw my sword &amp; shout</p>' },
  // a GM roll to self, the old export shape (whisperCount only): was printed as 🎲
  {
    timestamp: at(23),
    isRoll: true,
    alias: 'Goblin',
    flavor: 'Attack',
    whisperCount: 1,
    rolls: [{ formula: '1d20', total: 4 }],
  },
  // a GM whisper, the scribe's shape
  {
    timestamp: at(24),
    alias: 'Gamemaster',
    content: 'The goblin is a shapechanger.',
    whisper: true,
    whisperCount: 1,
    whisperTo: ['Gamemaster'],
  },
  {
    timestamp: at(26),
    isRoll: true,
    blind: true,
    alias: 'Aldric Stone',
    rolls: [{ formula: '1d20', total: 12 }],
  },
  { timestamp: at(-3600), alias: 'Early', content: 'before the recording' },
];

describe('buildTranscripts', () => {
  const out = buildTranscripts(META, SEGS, CHAT);

  it('merges a speaker across short gaps and interleaves chat by wall clock', () => {
    expect(out.full.split('\n')).toEqual([
      '# Session transcript — Guild / #voice',
      '',
      `- **Recorded:** ${START} (01:00:00 long)`,
      '- **Model:** large-v3-turbo on cuda/float16',
      '- **Chat events:** 5 in window, 1 outside',
      '',
      '---',
      '',
      '**[00:00:10] Aldric Stone:** I open the door. Carefully.',
      '',
      '**[00:00:20] Gamemaster:** A goblin leaps out!',
      '',
      '> 🎲 `[00:00:21]` Goblin — Stealth: 1d20 + 6 = 17',
      '',
      '> 💬 `[00:00:22]` Aldric Stone: I draw my sword & shout',
      '',
      '> 🤫 `[00:00:23]` Goblin — Attack: 1d20 = 4',
      '',
      '> 🤫 `[00:00:24]` Gamemaster (to Gamemaster): The goblin is a shapechanger.',
      '',
      '> 🤫 `[00:00:26]` Aldric Stone — roll: 1d20 = 12',
      '',
      '**[00:00:30] Aldric Stone:** Anyone there?',
      '',
    ]);
    expect(out.stats).toEqual({
      speechParagraphs: 3,
      chatEvents: 5,
      outsideWindow: 1,
      whispered: 3,
    });
  });

  it('withholds every whispered and blind event from the public transcript', () => {
    expect(out.public).not.toContain('🤫');
    expect(out.public).not.toContain('shapechanger');
    expect(out.public).toContain(
      '- **Chat events:** 2 in window (3 whispered or blind withheld), 1 outside'
    );
    expect(out.public).toContain('> 🎲 `[00:00:21]` Goblin — Stealth: 1d20 + 6 = 17');
    expect(out.public).toContain('**[00:00:30] Aldric Stone:** Anyone there?');
    expect(out.public.startsWith('# Public transcript — Guild / #voice')).toBe(true);
  });

  it('caps a paragraph at maxParagraphSeconds, breaking at a segment boundary', () => {
    const talky: Segments = {
      tracks: [
        {
          speaker: 'Gamemaster',
          segments: [0, 2, 4, 6].map(s => ({ start: s, end: s + 1.5, text: `s${s}` })),
        },
      ],
    };
    const lines = buildTranscripts(META, talky, [], {
      skewSeconds: 0,
      maxParagraphSeconds: 5,
      noWindow: false,
    })
      .full.split('\n')
      .filter(l => l.startsWith('**'));
    expect(lines).toEqual(['**[00:00:00] Gamemaster:** s0 s2', '**[00:00:04] Gamemaster:** s4 s6']);
  });

  it('applies skew, keeps out-of-window events with noWindow, and prints Python’s None', () => {
    const r = buildTranscripts(
      { startTime: START, durationSeconds: 60 },
      { tracks: [] },
      [
        { timestamp: at(-3600), content: 'x' },
        { timestamp: at(5), isRoll: true, rolls: [{ total: 3 }] },
      ],
      { skewSeconds: 2.5, maxParagraphSeconds: 75, noWindow: true }
    );
    expect(r.full).toContain('# Session transcript — ? / #?');
    expect(r.full).toContain('- **Model:** None on None');
    expect(r.full).toContain('- **Chat events:** 2 in window, 0 outside, skew +2.5s applied');
    expect(r.full).toContain('> 💬 `[00:00:00]` None: x');
    expect(r.full).toContain('> 🎲 `[00:00:07]` None — roll: ? = 3');
  });

  it('cuts long card text at 200 characters (code points) with an ellipsis', () => {
    const long = `${'🐉'.repeat(150)}${'a'.repeat(100)}`;
    const r = buildTranscripts(META, { tracks: [] }, [
      { timestamp: at(1), alias: 'X', content: long },
    ]);
    const line = r.full.split('\n').find(l => l.startsWith('> 💬')) ?? '';
    expect(line).toBe(`> 💬 \`[00:00:01]\` X: ${'🐉'.repeat(150)}${'a'.repeat(50)} …`);
  });
});

describe('helpers', () => {
  it('reads every visibility shape a chatlog.json has carried', () => {
    expect(isWhispered({})).toBe(false);
    expect(isWhispered({ whisperCount: 0, blind: false })).toBe(false);
    expect(isWhispered({ whisperCount: 2 })).toBe(true);
    expect(isWhispered({ whisper: true })).toBe(true);
    expect(isWhispered({ whisper: ['gm'] })).toBe(true);
    expect(isWhispered({ whisper: [] })).toBe(false);
    expect(isWhispered({ blind: true })).toBe(true);
  });

  it('strips and unescapes HTML the way Python’s html.unescape does for a chat log', () => {
    expect(stripHtml('<p>A&nbsp;&amp;&#39;B&#x2014;</p>\n <b>c</b>')).toBe("A &'B— c");
    expect(unescapeHtml('&unknown; &#0; &#x1F409;')).toBe('&unknown; &#0; 🐉');
  });

  it('formats clock times floored and never negative', () => {
    expect(hms(0)).toBe('00:00:00');
    expect(hms(3661.9)).toBe('01:01:01');
    expect(hms(-5)).toBe('00:00:00');
  });
});

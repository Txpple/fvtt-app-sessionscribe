import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanSessionChat, toChatRecord } from './chat.js';

// A minimal DOM for stripHtml: the detached-div text extraction, tags to spaces.
const fakeDocument = {
  createElement: () => {
    let html = '';
    return {
      set innerHTML(v: string) {
        html = v;
      },
      get textContent() {
        return html.replace(/<[^>]+>/g, ' ');
      },
    };
  },
};

const USERS = new Map([
  ['gm1', { name: 'Gamemaster' }],
  ['p1', { name: 'A Player' }],
]);

function msg(over: Record<string, unknown>) {
  return {
    id: 'm',
    author: 'p1',
    timestamp: 1_000,
    style: 0,
    isRoll: false,
    whisper: [],
    blind: false,
    content: '',
    speaker: { alias: 'Aldric Stone' },
    ...over,
  };
}

const g = globalThis as Record<string, unknown>;
beforeEach(() => {
  g.document = fakeDocument;
  g.game = {
    users: USERS,
    messages: {
      size: 5,
      contents: [
        msg({ id: 'late', timestamp: 9_000, content: '<p>after</p>' }),
        msg({ id: 'early', timestamp: 500, content: 'before' }),
        msg({ id: 'a', timestamp: 2_000, content: '<p>Hello   <b>there</b></p>' }),
        msg({
          id: 'w',
          timestamp: 3_000,
          author: 'gm1',
          whisper: ['gm1'],
          isRoll: true,
          blind: true,
          rolls: [{ total: 14, formula: '1d20 + 3' }],
          flavor: 'Stealth',
          speaker: { alias: 'Goblin' },
        }),
        msg({
          id: 'card',
          timestamp: 4_000,
          title: 'Fire Bolt - Use',
          system: { render: async () => '<div>Fire Bolt</div>' },
        }),
      ],
    },
  };
});
afterEach(() => {
  delete g.document;
  delete g.game;
});

describe('scanSessionChat', () => {
  it('keeps [since, until] oldest first and spells visibility out', async () => {
    const { totalMessages, records } = await scanSessionChat({ since: 1_000, until: 5_000 });
    expect(totalMessages).toBe(5);
    expect(records.map(r => r.id)).toEqual(['a', 'w', 'card']);
    expect(records[0]).toEqual({
      id: 'a',
      author: 'p1',
      timestamp: 2_000,
      time: '1970-01-01T00:00:02.000Z',
      style: 0,
      isRoll: false,
      whisperCount: 0,
      blind: false,
      whisper: false,
      authorName: 'A Player',
      alias: 'Aldric Stone',
      content: 'Hello there',
    });
    expect(records[1]).toMatchObject({
      whisperCount: 1,
      whisper: true,
      whisperTo: ['Gamemaster'],
      blind: true,
      isRoll: true,
      rolls: [{ total: 14, formula: '1d20 + 3' }],
      flavor: 'Stealth',
      content: '',
    });
    // a dnd5e 6.0 card with no content renders from its system data
    expect(records[2]).toMatchObject({ title: 'Fire Bolt - Use', content: 'Fire Bolt' });
  });

  it('reads the whole log with no bounds', async () => {
    const { records } = await scanSessionChat();
    expect(records.map(r => r.id)).toEqual(['early', 'a', 'w', 'card', 'late']);
  });

  it('keeps the MCP record’s key order, with the visibility keys after blind', async () => {
    const rec = await toChatRecord(msg({ whisper: [{ id: 'gm1' }], title: 'T' }));
    expect(Object.keys(rec)).toEqual([
      'id',
      'author',
      'timestamp',
      'time',
      'style',
      'isRoll',
      'whisperCount',
      'blind',
      'whisper',
      'whisperTo',
      'authorName',
      'alias',
      'content',
      'title',
    ]);
  });
});

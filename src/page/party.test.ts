import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportParty } from './party.js';

function actor(name: string, id: string) {
  const items = [
    { type: 'class', name: 'Fighter', subclass: { name: 'Battle Master' }, system: { levels: 3 } },
    { type: 'class', name: 'Rogue', subclass: null, system: { levels: 1 } },
    { type: 'feat', name: 'Alert', system: { type: { value: 'feat' } } },
    {
      type: 'feat',
      name: 'Second Wind',
      system: {
        type: { value: 'class' },
        uses: { max: 2, value: 1, recovery: [{ period: 'sr', type: 'recoverAll' }] },
      },
    },
    {
      type: 'feat',
      name: 'Lay on Hands',
      system: { type: { value: 'class' }, uses: { max: '20', value: 3 } },
    },
    {
      type: 'feat',
      name: 'Fighting Style',
      system: { type: { value: 'class' }, uses: { max: 0 } },
    },
    {
      type: 'equipment',
      name: 'Cloak of Protection',
      system: { equipped: true, attuned: true, properties: new Set(['mgc']) },
    },
    { type: 'weapon', name: 'Longsword', system: { equipped: true, properties: new Set(['ver']) } },
    {
      type: 'consumable',
      name: 'Wand of Magic Missiles',
      system: { uses: { max: 7, value: 4 }, quantity: 1, properties: new Set(['mgc']) },
    },
  ];
  const cloak = { documentName: 'Item', name: 'Cloak of Protection' };
  const appliedEffects = [
    { name: 'Cloak of Protection', parent: cloak, isTemporary: false, duration: { label: '' } },
    {
      name: 'Bless',
      origin: 'Actor.B1.Item.bless',
      isTemporary: true,
      duration: { label: '8 Rounds' },
    },
    { name: 'Prone', origin: null, isTemporary: true, duration: { label: '' } },
  ];
  return {
    id,
    name,
    type: 'character',
    items,
    appliedEffects,
    system: {
      details: { level: 4 },
      attributes: { hp: { value: 30, max: 38 }, ac: { value: 17 } },
      abilities: { str: { value: 16 }, dex: { value: 14 } },
      traits: { weaponProf: { mastery: { value: new Set(['longsword', 'shortbow']) } } },
      spells: {
        spell1: { value: 2, max: 3 },
        spell2: { value: 0, max: 0 },
        pact: { value: 0, max: 0 },
      },
    },
    toObject() {
      const flags = { dnd5e: { x: 1 } };
      // Foundry v14: exportSource is a getter-only, non-enumerable accessor on toObject().flags
      Object.defineProperty(flags, 'exportSource', { get: () => 'live', enumerable: false });
      return { name, _id: id, system: { hp: 38 }, items: [{ name: 'Longsword' }], flags };
    },
  };
}

const g = globalThis as Record<string, unknown>;
beforeEach(() => {
  g.fromUuidSync = (uuid: string) => (uuid === 'Actor.B1.Item.bless' ? { name: 'Bless' } : null);
  g.game = {
    world: { id: 'lost-mine' },
    system: { id: 'dnd5e', version: '6.0.3' },
    version: '14.368',
    actors: [
      actor('Aldric Stone', 'A1'),
      actor('Brenna Quickfoot', 'B1'),
      actor('Brenna Quickfoot', 'B2'),
    ],
  };
});
afterEach(() => {
  delete g.game;
  delete g.fromUuidSync;
});

describe('exportParty', () => {
  it('exports exactly what manage-actors export writes, with the exportSource envelope', () => {
    const { actors } = exportParty({ names: ['Aldric Stone'] });
    expect(actors[0]?.data).toEqual({
      name: 'Aldric Stone',
      _id: 'A1',
      system: { hp: 38 },
      items: [{ name: 'Longsword' }],
      flags: {
        dnd5e: { x: 1 },
        exportSource: {
          world: 'lost-mine',
          system: 'dnd5e',
          coreVersion: '14.368',
          systemVersion: '6.0.3',
        },
      },
    });
  });

  it('digests the live sheet, turning every Set into an array', () => {
    const { actors } = exportParty({ names: ['Aldric Stone'] });
    const digest = actors[0]?.digest;
    expect(digest).toEqual({
      name: 'Aldric Stone',
      level: 4,
      classes: [
        { name: 'Fighter', subclass: 'Battle Master', levels: 3 },
        { name: 'Rogue', subclass: null, levels: 1 },
      ],
      hp: { value: 30, max: 38 },
      ac: 17,
      abilities: { str: 16, dex: 14 },
      feats: ['Alert'],
      masteries: ['longsword', 'shortbow'],
      spellSlots: [{ slot: 'spell1', value: 2, max: 3 }],
      attuned: ['Cloak of Protection'],
      equippedMagic: ['Cloak of Protection'],
      charges: [{ name: 'Wand of Magic Missiles', value: 4, max: 7, quantity: 1 }],
      // feature pools with limited uses, a formula-string max read as a number, no-use feats out
      features: [
        { name: 'Second Wind', value: 1, max: 2, recovery: 'sr' },
        { name: 'Lay on Hands', value: 3, max: 20, recovery: null },
      ],
      // what stands on the sheet: an item passive (named by its item), a timed buff (named by
      // its origin), a condition with no origin
      effects: [
        {
          name: 'Cloak of Protection',
          from: 'Cloak of Protection',
          temporary: false,
          duration: null,
        },
        { name: 'Bless', from: 'Bless', temporary: true, duration: '8 Rounds' },
        { name: 'Prone', from: null, temporary: true, duration: null },
      ],
    });
    // what the JSON boundary will carry: no Set flattened to {}
    expect(JSON.parse(JSON.stringify(digest)).masteries).toEqual(['longsword', 'shortbow']);
  });

  it('reports a missing name and an ambiguous one instead of guessing', () => {
    const r = exportParty({ names: ['Aldric Stone', 'Brenna Quickfoot', 'Nobody'] });
    expect(r.actors.map(a => a.name)).toEqual(['Aldric Stone']);
    expect(r.missing).toEqual(['Nobody']);
    expect(r.ambiguous).toEqual([{ name: 'Brenna Quickfoot', ids: ['B1', 'B2'] }]);
  });
});

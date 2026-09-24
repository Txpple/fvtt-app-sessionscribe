// Page-side: the party snapshot. For each campaign.json party member, by EXACT actor name:
//   data    the complete native export, byte-compatible with fvtt-mcp-dnd5e's
//           `manage-actors export` (toObject() + the exportSource envelope ClientDocument's
//           exportToJSON writes), so it restores through the sheet's Import Data button
//   digest  the facts the human-readable snapshot is written from, off the LIVE (derived) sheet:
//           the sheet's numbers, the item charges, the feature pools' remaining uses and the
//           active effects standing at the wrap
// Read-only. A name that matches no actor, or several, is reported, never guessed at.
//
// dnd5e keeps weapon masteries and item properties in Sets; every Set is turned into an array
// here, because the JSON boundary (src/page/index.ts) would flatten one to `{}` silently.

export interface PcDigest {
  name: string;
  level: number | null;
  classes: Array<{ name: string; subclass: string | null; levels: number }>;
  hp: { value: number | null; max: number | null };
  ac: number | null;
  abilities: Record<string, number | null>;
  feats: string[];
  masteries: string[];
  spellSlots: Array<{ slot: string; value: number; max: number }>;
  attuned: string[];
  equippedMagic: string[];
  charges: Array<{
    name: string;
    value: number | null;
    max: number | null;
    quantity: number | null;
  }>;
  /** Feature and spell pools with limited uses (Lay on Hands, Second Wind, superiority dice…). */
  features: Array<{
    name: string;
    value: number | null;
    max: number | null;
    /** dnd5e's recovery period for the pool (lr, sr, day…), or null when it never recovers. */
    recovery: string | null;
  }>;
  /** The active effects applied to the sheet right now: buffs, conditions, item passives. */
  effects: Array<{
    name: string;
    /** The item or document the effect came from, by name, when it can be resolved. */
    from: string | null;
    /** A timed effect (rounds, turns or seconds), as opposed to an item's standing passive. */
    temporary: boolean;
    /** dnd5e's remaining-duration label ("3 Rounds", "1 Hour"), or null for a passive. */
    duration: string | null;
  }>;
}

const toArray = (v: unknown): string[] =>
  v instanceof Set ? [...v].map(String) : Array.isArray(v) ? v.map(String) : [];

const num = (v: unknown): number | null => {
  // uses.max is a formula string in the source; the derived sheet has it as a number, but a
  // numeric string still counts (a bare "3" survives preparation on some item types).
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** The name of an effect's source: its parent item, else the document its origin points at. */
function effectSource(e: any): string | null {
  if (e.parent && e.parent.documentName === 'Item') return str(e.parent.name);
  if (typeof e.origin === 'string' && typeof fromUuidSync === 'function') {
    try {
      return str(fromUuidSync(e.origin)?.name);
    } catch {
      return null;
    }
  }
  return null;
}

/** The same object manage-actors export writes (fvtt-mcp-dnd5e src/page/actors/reads.ts). */
function exportData(actor: any): unknown {
  const data: any = actor.toObject();
  // v14 pre-defines toObject().flags.exportSource as a getter-only NON-ENUMERABLE accessor, so
  // plain assignment throws in strict mode; rebuild flags as plain data (the spread skips it).
  data.flags = {
    ...(data.flags ?? {}),
    exportSource: {
      world: game.world?.id,
      system: game.system?.id,
      coreVersion: game.version,
      systemVersion: game.system?.version,
    },
  };
  return data;
}

export function digestOf(actor: any): PcDigest {
  const sys = actor.system ?? {};
  const items: any[] = [...(actor.items ?? [])];
  const classes = items
    .filter(i => i.type === 'class')
    .map(c => ({
      name: String(c.name),
      subclass: c.subclass?.name ?? null,
      levels: num(c.system?.levels) ?? 0,
    }));
  const spellSlots: PcDigest['spellSlots'] = [];
  for (const [slot, s] of Object.entries<any>(sys.spells ?? {})) {
    const max = num(s?.max);
    if (max) spellSlots.push({ slot, value: num(s?.value) ?? 0, max });
  }
  const isFeature = (i: any) =>
    ['feat', 'spell', 'class', 'subclass', 'background', 'race'].includes(i.type);
  return {
    name: String(actor.name),
    level: num(sys.details?.level),
    classes,
    hp: { value: num(sys.attributes?.hp?.value), max: num(sys.attributes?.hp?.max) },
    ac: num(sys.attributes?.ac?.value),
    abilities: Object.fromEntries(
      Object.entries<any>(sys.abilities ?? {}).map(([k, a]) => [k, num(a?.value)])
    ),
    feats: items
      .filter(i => i.type === 'feat' && i.system?.type?.value === 'feat')
      .map(i => String(i.name)),
    masteries: toArray(sys.traits?.weaponProf?.mastery?.value),
    spellSlots,
    attuned: items.filter(i => i.system?.attuned === true).map(i => String(i.name)),
    equippedMagic: items
      .filter(i => i.system?.equipped === true && toArray(i.system?.properties).includes('mgc'))
      .map(i => String(i.name)),
    charges: items
      .filter(i => !isFeature(i) && (num(i.system?.uses?.max) ?? 0) > 0)
      .map(i => ({
        name: String(i.name),
        value: num(i.system?.uses?.value),
        max: num(i.system?.uses?.max),
        quantity: num(i.system?.quantity),
      })),
    features: items
      .filter(i => ['feat', 'spell'].includes(i.type) && (num(i.system?.uses?.max) ?? 0) > 0)
      .map(i => ({
        name: String(i.name),
        value: num(i.system?.uses?.value),
        max: num(i.system?.uses?.max),
        recovery: str(i.system?.uses?.recovery?.[0]?.period),
      })),
    // appliedEffects (v11+) is already net of disabled and suppressed effects.
    effects: [...(actor.appliedEffects ?? [])].map((e: any) => ({
      name: String(e.name),
      from: effectSource(e),
      temporary: e.isTemporary === true,
      duration: e.isTemporary === true ? str(e.duration?.label) : null,
    })),
  };
}

export interface ExportPartyArgs {
  names: string[];
}

export function exportParty(args: ExportPartyArgs) {
  const actors: Array<{ name: string; id: string; type: string; data: unknown; digest: PcDigest }> =
    [];
  const missing: string[] = [];
  const ambiguous: Array<{ name: string; ids: string[] }> = [];
  for (const name of args.names ?? []) {
    const matches = [...game.actors].filter((a: any) => a.name === name);
    if (matches.length === 0) missing.push(name);
    else if (matches.length > 1) ambiguous.push({ name, ids: matches.map((a: any) => a.id) });
    else {
      const actor: any = matches[0];
      actors.push({
        name,
        id: actor.id,
        type: actor.type,
        data: exportData(actor),
        digest: digestOf(actor),
      });
    }
  }
  return { actors, missing, ambiguous };
}

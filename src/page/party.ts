// Page-side: the party snapshot. For each campaign.json party member, by EXACT actor name:
//   data    the complete native export, byte-compatible with fvtt-mcp-dnd5e's
//           `manage-actors export` (toObject() + the exportSource envelope ClientDocument's
//           exportToJSON writes), so it restores through the sheet's Import Data button
//   digest  the facts the human-readable snapshot is written from, off the LIVE (derived) sheet
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
}

const toArray = (v: unknown): string[] =>
  v instanceof Set ? [...v].map(String) : Array.isArray(v) ? v.map(String) : [];

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

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

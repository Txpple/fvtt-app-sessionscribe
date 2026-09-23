// The first read of every connection: which world this is, who the scribe joined as, and who
// holds the GM election. The reader child refuses on its answer before any other op runs: a world
// other than campaign.json's `worldId`, or the scribe being the elected GM while a combat runs
// (Battle Flow gates its GM-only automation on `game.users.activeGM?.isSelf`, so an elected
// scribe page would run it).

export interface WorldProbe {
  worldId: string;
  worldTitle: string;
  foundryVersion: string;
  system: { id: string; version: string };
  user: { name: string; role: number; isGM: boolean };
  activeGM: { name: string; isSelf: boolean } | null;
  gmsConnected: Array<{ name: string; role: number }>;
  combatActive: boolean;
  battleflow: { active: boolean; version: string } | null;
  messageCount: number;
}

export function probe(): WorldProbe {
  const users = [...game.users] as any[];
  const active = game.users.activeGM;
  const bf = game.modules.get('fvtt-mod-battleflow');
  return {
    worldId: String(game.world.id),
    worldTitle: String(game.world.title ?? ''),
    foundryVersion: String(game.version),
    system: { id: String(game.system.id), version: String(game.system.version) },
    user: { name: game.user.name, role: game.user.role, isGM: Boolean(game.user.isGM) },
    activeGM: active ? { name: active.name, isSelf: Boolean(active.isSelf) } : null,
    gmsConnected: users.filter(u => u.active && u.isGM).map(u => ({ name: u.name, role: u.role })),
    combatActive: [...game.combats].some((c: any) => Boolean(c.started)),
    battleflow: bf ? { active: Boolean(bf.active), version: String(bf.version ?? '') } : null,
    messageCount: game.messages.size,
  };
}

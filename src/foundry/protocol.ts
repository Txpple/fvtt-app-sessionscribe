// The contract between the server and the one-shot reader child (src/workers/foundry-read.ts).
// The server writes one ReadRequest to the child's stdin; the child prints exactly one
// SENTINEL-prefixed ReadResponse line to stdout and exits. Anything else on stdout (a library's
// stray log line) is ignored, so the reply can never be confused with noise.

import type { HostName } from '../config.js';
import type { WorldProbe } from '../page/probe.js';

export const SENTINEL = '@@scribe-read@@';

export interface ReadRequest {
  /** A window.__scribe op; 'probe' alone just connects, identifies the world, and hangs up. */
  op: string;
  args?: unknown;
  host: HostName;
  /** campaign.json's worldId: a connection to any other world is refused before `op` runs. */
  worldId?: string;
  /** The child's own watchdog; the server kills it a margin after this. */
  timeoutMs?: number;
}

export interface ReadResponse<T = unknown> {
  ok: boolean;
  host: HostName;
  /** When the read ran (ISO), stamped into every output built from it. */
  readAt?: string;
  probe?: WorldProbe;
  result?: T;
  error?: string;
}

export const DEFAULT_READ_TIMEOUT_MS = 240_000;

/**
 * Refuse a connection the scribe must not read through. Returns the refusal, or null to proceed.
 * Pure, so the rules are unit-tested rather than trusted to the live path.
 */
export function refusal(probe: WorldProbe, worldId: string | undefined): string | null {
  if (worldId && probe.worldId !== worldId) {
    return (
      `connected to world "${probe.worldId}" but campaign.json's worldId is "${worldId}": ` +
      'refusing to read another world into this campaign.'
    );
  }
  if (!probe.user.isGM) {
    return (
      `"${probe.user.name}" joined with role ${probe.user.role}: the scribe needs Assistant GM ` +
      '(3) to see whispers and Battle Flow’s GM cards.'
    );
  }
  if (probe.activeGM?.isSelf && probe.combatActive) {
    return (
      'the scribe is the elected GM while a combat is running, so Battle Flow’s GM-only ' +
      'automation would run on its page. Connect the DM’s client first, or end the combat.'
    );
  }
  return null;
}

/** Pull the one reply line out of the child's stdout. */
export function parseReply<T>(stdout: string): ReadResponse<T> | null {
  const lines = stdout.split(/\r?\n/).filter(l => l.startsWith(SENTINEL));
  const last = lines.at(-1);
  if (!last) return null;
  try {
    return JSON.parse(last.slice(SENTINEL.length)) as ReadResponse<T>;
  } catch {
    return null;
  }
}

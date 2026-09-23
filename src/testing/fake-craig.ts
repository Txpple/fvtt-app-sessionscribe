// A fake Craig server for the tests: routes by path, checks the key on every API call.

import type { Fetch } from '../craig.js';

/** A fake Craig: routes by path (the key checked on every call), answers JSON or a status. */
export function fakeCraig(
  routes: Record<string, unknown | ((init?: RequestInit) => { status: number; body?: unknown })>,
  seen: string[] = []
): Fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    seen.push(`${init?.method ?? 'GET'} ${url.pathname}`);
    if (url.pathname.startsWith('/api') && url.searchParams.get('key') !== 's3cr3tK3y') {
      return new Response('{}', { status: 403 });
    }
    const route = routes[url.pathname];
    if (route === undefined) return new Response('{"error":"nope"}', { status: 404 });
    const r =
      typeof route === 'function'
        ? (route as (i?: RequestInit) => any)(init)
        : { status: 200, body: route };
    const body = r.body instanceof Uint8Array ? r.body : JSON.stringify(r.body ?? {});
    return new Response(body as BodyInit, { status: r.status });
  }) as Fetch;
}

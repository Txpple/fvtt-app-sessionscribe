// Server side of a Foundry read: spawn the one-shot reader child, hand it the request on stdin,
// take its one reply line from stdout. The server never imports the Foundry client, so it never
// holds a browser; if the child hangs past its own watchdog, the server kills it.

import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { repoRoot } from '../config.js';
import {
  DEFAULT_READ_TIMEOUT_MS,
  parseReply,
  type ReadRequest,
  type ReadResponse,
} from './protocol.js';

export type WorldReader = <T = unknown>(req: ReadRequest) => Promise<ReadResponse<T>>;

const KILL_MARGIN_MS = 30_000;
const STDERR_TAIL = 1_500;

export const READER_SCRIPT = path.join(repoRoot, 'dist', 'workers', 'foundry-read.js');

/** A WorldReader over a reader script (the real one, or a fake in the tests). */
export function childReader(
  script: string = READER_SCRIPT,
  opts: { killMarginMs?: number } = {}
): WorldReader {
  const margin = opts.killMarginMs ?? KILL_MARGIN_MS;
  return <T>(req: ReadRequest) =>
    new Promise<ReadResponse<T>>(resolve => {
      const child = spawn(process.execPath, [script], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', d => {
        stdout += d;
      });
      child.stderr.on('data', d => {
        stderr += d;
      });
      const limit = (req.timeoutMs ?? DEFAULT_READ_TIMEOUT_MS) + margin;
      const killer = setTimeout(() => child.kill(), limit);
      child.on('error', err => {
        clearTimeout(killer);
        resolve({ ok: false, host: req.host, error: `reader failed to start: ${err.message}` });
      });
      child.on('close', code => {
        clearTimeout(killer);
        const reply = parseReply<T>(stdout);
        if (reply) return resolve(reply);
        const tail = stderr.trim().slice(-STDERR_TAIL);
        resolve({
          ok: false,
          host: req.host,
          error: `reader exited ${code ?? 'on a signal'} without a reply${tail ? `: ${tail}` : ''}`,
        });
      });
      child.stdin.end(JSON.stringify(req));
    });
}

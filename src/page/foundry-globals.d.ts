// Ambient globals inside the headless Foundry page, where src/page/** runs. Declared loosely, as
// fvtt-mcp-dnd5e does (foundry-vtt-types does not cover Foundry 14): correctness comes from the
// live parity checks, not these stubs.

declare const game: any;
declare const CONFIG: any;
declare const foundry: any;
declare const fromUuidSync: (uuid: string) => any;

interface Window {
  /** The scribe's page API; every op answers a JSON string (see src/page/index.ts). */
  __scribe: Record<string, (args?: any) => string | Promise<string>>;
}

/* The few Node APIs the test fixtures use (the project has no Node type package; tests run in Node). */
declare module 'node:child_process' {
  export function execFileSync(file: string, args: string[], opts?: { stdio?: string }): Uint8Array;
}
declare module 'node:fs' {
  export function mkdtempSync(prefix: string): string;
  export function mkdirSync(path: string, opts?: { recursive?: boolean }): void;
  export function readFileSync(path: string): Uint8Array;
  export function existsSync(path: string): boolean;
  export function writeFileSync(path: string, data: string): void;
}
declare module 'node:os' {
  export function tmpdir(): string;
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
}
declare module 'node:zlib' {
  export function inflateSync(data: Uint8Array): Uint8Array;
  export function deflateSync(data: Uint8Array, opts?: { level?: number }): Uint8Array;
}
declare const process: { execPath: string; env: Record<string, string | undefined> };

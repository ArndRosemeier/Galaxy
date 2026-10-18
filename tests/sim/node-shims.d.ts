/**
 * Minimal ambient types for the Node built-ins the cross-process determinism pin needs.
 *
 * The project's tsconfig deliberately ships without `@types/node` (the app is a browser
 * app), and adding a dependency is out of scope for the simulation layer. These
 * declarations cover exactly the handful of signatures `tests/sim/pins.test.ts` calls;
 * they are test-only and add no runtime code. Delete this file if `@types/node` is ever
 * added to the project.
 */

declare module 'node:crypto' {
  export interface Hash {
    update(data: string): Hash;
    digest(encoding: 'hex'): string;
  }
  export function createHash(algorithm: string): Hash;
}

declare module 'node:child_process' {
  export function execFileSync(
    file: string,
    args: readonly string[],
    options: {
      readonly cwd: string;
      readonly encoding: 'utf8';
      readonly timeout: number;
    },
  ): string;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}

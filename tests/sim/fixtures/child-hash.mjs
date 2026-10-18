/**
 * A child process that generates a galaxy through the real TypeScript sources and prints
 * one SHA-256, so the cross-process determinism pin compares two actual OS processes.
 *
 * Node 24 strips types natively; the hook below teaches it the extensionless relative
 * imports TypeScript resolves under `moduleResolution: bundler`. Nothing here is a
 * reimplementation of generation: it imports `src/sim/index.ts` itself.
 */

import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      (specifier.startsWith('./') || specifier.startsWith('../')) &&
      !/\.[a-zA-Z0-9]+$/.test(specifier)
    ) {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        return nextResolve(specifier, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

const root = process.cwd();
const raw = process.argv[2];
if (!raw) {
  process.stderr.write('child-hash: expected a JSON params argument\n');
  process.exit(2);
}
const params = JSON.parse(raw);
const sim = await import(pathToFileURL(resolve(root, 'src/sim/index.ts')).href);
const galaxy = sim.generateGalaxy(params);
const firstStub = galaxy.systems[0];
if (!firstStub) {
  process.stderr.write('child-hash: the galaxy generated no systems\n');
  process.exit(2);
}
const payload = {
  galaxy,
  firstSystem: sim.generateSystem(firstStub),
};
process.stdout.write(`${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}\n`);

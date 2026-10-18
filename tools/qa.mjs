#!/usr/bin/env node
/**
 * qa.mjs — the final gate you can look at.
 *
 * Runs a fixed set of visual scenarios through `tools/shoot.mjs`, then reports one
 * table: exit status, console errors, page exceptions, renderer counts and the size of
 * each frame. A blank or broken build fails loudly here (a real frame of a real scene
 * never compresses to a few kilobytes), and the dispatcher reads the PNGs afterwards.
 *
 * Does not start a long-lived server: each shot serves `dist/` itself and kills its own
 * browser tree, so nothing this script starts survives it.
 *
 *   pnpm build && node tools/qa.mjs
 *   node tools/qa.mjs --only galaxy
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
const root = process.cwd();
const outDir = resolve(root, 'shots/qa');
mkdirSync(outDir, { recursive: true });

/** Find a world worth showing in the "details" shot: an inhabited ocean world. */
const FIND_CIVILISATION = `(() => {
  const app = window.__galaxy;
  for (let i = 0; i < app.galaxy.systems.length; i += 1) {
    const s = app.systemFor(app.galaxy.systems[i]);
    for (let j = 0; j < s.planets.length; j += 1) {
      if (s.planets[j].biosphere?.level === 'civilization' || s.planets[j].biosphere?.level === 'fauna') return [i, j];
    }
  }
  return null;
})()`;

const scenarios = [
  { name: 'galaxy', size: '1440x900', wait: 6000, evalJs: [] },
  {
    name: 'e2e-click',
    size: '1440x900',
    wait: 5000,
    evalJs: [],
    clickSelectors: ['#scene'],
    expectView: 'system',
  },
  { name: 'galaxy-phone', size: '390x844', wait: 6000, evalJs: [] },
  { name: 'system', size: '1440x900', wait: 5000, evalJs: ['window.__galaxy.goto(4)'] },
  { name: 'system-phone', size: '390x844', wait: 5000, evalJs: ['window.__galaxy.goto(4)'] },
  { name: 'planet', size: '1440x900', wait: 5000, evalJs: ['window.__galaxy.gotoPlanet(4, 1)'] },
  { name: 'planet-phone', size: '390x844', wait: 5000, evalJs: ['window.__galaxy.gotoPlanet(4, 1)'] },
  {
    name: 'planet-life',
    size: '1440x900',
    wait: 6000,
    evalJs: [],
    /** ask the page where a living world is, then go there in a second pass */
    dynamic: FIND_CIVILISATION,
  },
];

const INFO = 'window.__galaxy.info()';

function runShot(scenario, extraEval = []) {
  const out = resolve(outDir, `${scenario.name}.png`);
  const args = ['tools/shoot.mjs', '--serve', 'dist', '--url', '/', '--out', out];
  args.push('--size', scenario.size, '--wait', String(scenario.wait));
  for (const js of [...scenario.evalJs, ...extraEval]) args.push('--eval', js);
  for (const sel of scenario.clickSelectors ?? []) args.push('--click-selector', sel);
  args.push('--print', INFO);
  args.push('--print', 'window.__galaxy.store.state.view');

  const res = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  let parsed = null;
  try {
    parsed = JSON.parse(res.stdout.slice(res.stdout.indexOf('{')));
  } catch {
    parsed = null;
  }
  return {
    scenario: scenario.name,
    exit: res.status,
    shot: out,
    bytes: parsed?.bytes ?? (statExists(out) ? statSync(out).size : 0),
    errors: (parsed?.consoleErrors?.length ?? 0) + (parsed?.pageErrors?.length ?? 0),
    info: parsed?.prints?.[0] ?? null,
    view: parsed?.prints?.[1] ?? null,
    expectView: scenario.expectView ?? null,
    stderr: res.stderr?.trim().slice(0, 300) ?? '',
  };
}

function statExists(path) {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

const results = [];

for (const scenario of scenarios) {
  if (only && !scenario.name.includes(only)) continue;

  if (scenario.dynamic) {
    // Two passes: find a target, then shoot it. Kept separate so a failure to find one
    // is its own, readable result instead of a mysterious blank frame.
    const finder = spawnSync(
      process.execPath,
      [
        'tools/shoot.mjs',
        '--serve',
        'dist',
        '--url',
        '/',
        '--out',
        resolve(outDir, `${scenario.name}-probe.png`),
        '--size',
        scenario.size,
        '--wait',
        '6000',
        '--print',
        scenario.dynamic,
      ],
      { cwd: root, encoding: 'utf8' },
    );
    let target = null;
    try {
      target = JSON.parse(finder.stdout.slice(finder.stdout.indexOf('{'))).prints?.[0] ?? null;
    } catch {
      target = null;
    }
    if (!Array.isArray(target)) {
      results.push({
        scenario: scenario.name,
        exit: 1,
        shot: '-',
        bytes: 0,
        errors: 0,
        info: null,
        stderr: 'no inhabited world found in the default galaxy',
      });
      continue;
    }
    const [si, pi] = target;
    results.push(runShot(scenario, [`window.__galaxy.gotoPlanet(${si}, ${pi})`]));
    continue;
  }

  results.push(runShot(scenario));
}

const pad = (v, n) => String(v).padEnd(n);
const padL = (v, n) => String(v).padStart(n);
console.log(
  `${pad('scenario', 16)} ${padL('exit', 4)} ${padL('errors', 6)} ${padL('kb', 6)} ${padL('draws', 5)} ${padL('tris', 7)} ${padL('points', 7)}`,
);
let failed = 0;
for (const r of results) {
  const kb = Math.round(r.bytes / 1024);
  const info = r.info ?? { drawCalls: '-', triangles: '-', points: '-' };
  const viewMiss = r.expectView && r.view !== r.expectView;
  if (r.exit !== 0 || r.errors > 0 || r.bytes < 100_000 || viewMiss) failed += 1;
  if (viewMiss) console.log(`  expected view ${r.expectView}, got ${r.view ?? 'none'}`);
  console.log(
    `${pad(r.scenario, 16)} ${padL(r.exit, 4)} ${padL(r.errors, 6)} ${padL(kb, 6)} ${padL(info.drawCalls, 5)} ${padL(info.triangles, 7)} ${padL(info.points, 7)}`,
  );
  if (r.stderr) console.log(`  ${r.stderr}`);
}

console.log(`\n${results.length - failed}/${results.length} scenarios clean · frames in shots/qa/`);
process.exitCode = failed === 0 ? 0 : 1;

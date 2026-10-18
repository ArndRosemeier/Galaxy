# Galaxy

A procedural galaxy creator in the browser. A seed becomes a spiral galaxy; a click
takes you to a star system, another click to a world — each with its own physical
detail, and every one of them generated, never stored.

![The galaxy view](docs/shots/galaxy.png)

## What you can do

- **Make a galaxy.** Ten parameters, from the number of arms to how much debris the
  place carries, with presets and a randomize button. The same seed always makes the
  same galaxy, so a link is a place.
- **Fly in.** Click a star to enter its system: planets on their true orbits, moons,
  rings, asteroid belts, and a star that lights the whole scene.
- **Land on a world.** Click a planet to fill the frame with it: continents and oceans,
  weather, an atmosphere rim, night-side city lights, rings and shadows.
- **Read the dossier.** Every world has real numbers — radius, mass, gravity,
  temperature, day and year, atmosphere composition, hydrosphere, biosphere, moons —
  plus a short description and tags.
- **Share.** The URL is the whole state: seed, parameters, time, and where you are.

## How it works

```
src/sim      pure, seeded generation: galaxy → systems → planets → moons → belts
src/render   three.js: galaxy point cloud, system scene, planet shaders
src/app      state store, share-link codec, and the controller that joins the two
src/ui       the panels, inspector and controls
```

Nothing is generated twice from different code. `src/sim/types.ts` is the frozen data
contract; the renderer turns `SurfaceSpec` recipes into surfaces on the GPU, so a world
costs a handful of uniforms instead of a texture. Orbits come from one Kepler
implementation, `src/sim/orbit.ts`, used by both the generator and the renderer.

Determinism is a test, not a hope: the same params produce byte-identical JSON in two
separate processes, and the suite proves it on every run.

## Development

```bash
pnpm install
pnpm dev          # http://127.0.0.1:5173
pnpm build        # typecheck + production build into dist/
pnpm test         # vitest
```

The project's one verification command is the gate:

```bash
bash scripts/gate.sh                 # full: typecheck + tests + build
GATE_TESTS=0 bash scripts/gate.sh    # cheap: typecheck only (exit 2)
```

Exit codes: `0` green · `1` red · `2` cheap tier only · `9` refused (lock busy,
VOID). See `scripts/gate.sh` and `docs/TESTING.md`.

## Visual verification

The look is checked by looking:

```bash
node tools/qa.mjs     # shoots every view at laptop and phone width into shots/qa/
```

`tools/shoot.mjs` is the underlying harness: it serves `dist/`, drives headless Chrome
(software WebGL), captures a frame, reports console errors, and kills its browser
process tree when it exits.

## Credits

Built with [three.js](https://threejs.org/), Vite and Vitest. Everything you see is
generated from code and a seed — no image textures, no downloaded assets.

## Process

This repository is built under the working process in
[Toolbox](https://github.com/ArndRosemeier/Toolbox): a board as the state of record
(`docs/BOARD.md`), a decision ledger (`docs/DECISION-LEDGER.md`), one gate command, and
briefs. If you are picking this up cold, read those two files first.

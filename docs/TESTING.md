# Testing and verification

**One gate command.** `bash scripts/gate.sh` — see the header of `scripts/gate.sh`
for the exit vocabulary and `AGENTS.md` for the rules around it.

| | Cheap tier | Full tier |
| --- | --- | --- |
| Command | `GATE_TESTS=0 bash scripts/gate.sh` | `bash scripts/gate.sh` |
| Runs | `tsc --noEmit` | the suite, then the production build |
| Exit | `2` (green, suite **not** run) | `0` green · `1` red |
| Blocks | a push | — |

`2` is never "the gate passed". A change is VERIFIED only on `0`.

## What unit tests must cover (`vitest`, `tests/**/*.test.ts`)

Generation is pure, so it is fully testable without a browser:

1. **Determinism** — the same params produce byte-identical JSON, twice, and after a
   JSON round-trip. Different seeds produce different galaxies.
2. **Bounds** — every physical field lands in its plausible range (radius, mass,
   gravity, temperature, albedo, orbit elements), for every `PlanetKind` the galaxy
   produces. A generated planet that violates physics is a red test, not a curiosity.
3. **Structural invariants** — planets are ordered by semi-major axis with no
   crossing orbits; moons orbit inside their planet's Hill sphere; rings lie outside
   the planet's fluid Roche limit; gas giants have no solid surface.
4. **Consistency with what is drawn** — positions used by tests come from
   `src/sim/orbit.ts`, the same module the renderer uses, so "the test says the planet
   is here" and "the renderer draws it here" cannot disagree.
5. **Performance floor** — generating a 600-system galaxy stays under a generous
   budget (currently 150 ms on this host) so the UI never freezes on a slider.

## What unit tests must not try to cover

Shaders, camera feel and layout. Those are verified by **looking at a frame**, which
is what the harness below exists for. A test that asserts a colour by reading one
pixel from SwiftShader is brittle and proves less than a screenshot a person reads.

## Visual verification — `tools/shoot.mjs`

```bash
pnpm build
node tools/shoot.mjs --serve dist --url / --out shots/home.png
node tools/shoot.mjs --serve dist --url / --out shots/zoom.png --wheel 720,450,-800 --wait 3000
node tools/shoot.mjs --serve dist --url / --out shots/click.png --click 640,420 --wait 3000
```

It serves the directory itself (no dev server to leak), launches headless Chrome with
software WebGL, captures a PNG, prints console errors and page exceptions, and kills
the whole Chrome process tree — **on success and on failure alike**. Exit `0` means
captured and clean; exit `1` means the page erred or the capture failed.

Read the PNG with an image viewer. That is the point: the frame is the test.

**Software GL is slow.** Do not read wall-clock frame times here as the app's
performance; use `renderer.info` counts against the budget in
`docs/ARCHITECTURE.md`. Do not claim a frame rate from this host.

**The owner's browser lives on this host.** Count `chrome` before and after a run:
the owner's session is one tree of ~15 processes and must be untouched. A browser the
harness starts belongs to the harness and is killed in `finally`.

## Manual checks that still need a person

- "Looks pleasing" — composition, colour, contrast, the zoom transition's feel.
- "Easy and intuitive" — can someone find the controls without being told?
- Legibility at laptop and at phone width (`--size 390x844`).

The agent can catch regressions and severe ugliness; taste is the owner's.

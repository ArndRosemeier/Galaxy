# Architecture — the seam index

Galaxy is a browser app in TypeScript. It generates a galaxy from a seed and lets you
fall from whole-disc scale to a single world. This doc names the **one** way each
thing is done, so a change has an obvious home and a second implementation is a
defect rather than a style choice.

Read `src/sim/types.ts` first — it is the frozen data contract, and this document
assumes it.

## Layers

Dependencies point **down only**. Nothing below imports anything above it.

```
src/ui/**        DOM panels, sliders, inspector, keyboard, URL state     (no WebGL)
src/app/**       state store + the controller joining sim and renderer    (no DOM, no WebGL)
src/render/**    three.js scene graph, materials, post-processing         (no DOM UI, no generation)
src/sim/**       pure generation: data in, data out. No three, no DOM      (no side effects)
src/main.ts      the only file that wires the layers together
```

- **`src/sim` never imports `three`, `document`, `window`, `Date.now` or `Math.random`.**
  Generation is a pure function of `GalaxyParams`; the same seed must produce the same
  JSON on any machine, today and tomorrow. That is what makes screenshots, tests and
  share links meaningful.
- **`src/render` never generates content.** It renders the objects it is given and
  asks nothing of the seed beyond the `SurfaceSpec`/`Orbit` it already holds.
- **`src/ui` never touches a camera, a mesh or a GL context.** It calls the app
  interface; the app calls the renderer.
- **`src/app` is the only place that knows both sides.** `state.ts` holds the data and
  the share-link codec; `controller.ts` is the only file that holds a renderer and a
  generator at once, and it is deliberately small. A pick goes into the store; a store
  change is applied to the renderer. Nothing else is allowed to do either.

## The one way to do X

| Do | The one way | Where |
| --- | --- | --- |
| Randomness | seeded PRNG, never `Math.random` | `src/sim/rng.ts` |
| Noise | the project's noise module | `src/sim/noise.ts` |
| Orbital position | `positionAtAU` / `moonPositionKm` | `src/sim/orbit.ts` |
| World generation | `generateGalaxy` → `generateSystem` | `src/sim/index.ts` |
| Surface look | `SurfaceSpec` produced by sim, consumed by the planet shader | `src/sim/types.ts`, `src/render/**` |
| Units, colour space, angles | the conventions in `src/sim/types.ts` | — |
| Selection and time | app state store | `src/app/state.ts` |
| Camera motion | one camera rig with named transitions | `src/render/camera.ts` |
| Panels and controls | `src/ui` primitives (`.panel`, `.field`, `.btn`, `.kv` in `src/styles.css`) | `src/ui/**` |
| Visual verification | `node tools/shoot.mjs` | `tools/shoot.mjs` |

If a change needs a second copy of any of these, it needs a seam instead.

## View scales

Three nested views, each with its own unit and its own scene contents. Camera
transitions between them are the app's business; the renderer exposes `setView`.

| View | Unit | Contents |
| --- | --- | --- |
| `galaxy` | galaxy unit (gu) | star sprites, dust, arm structure; the whole disc |
| `system` | AU | star, orbits, planets, moons, belts |
| `planet` | planet radius | the world itself: surface, atmosphere, rings, moons as sky objects |

Numbers never cross a view boundary unchanged: `render/scales.ts` owns the scale
constants per view. A planet is drawn at `radiusKm` converted to the current view's
unit; it is never drawn in metres next to something measured in AU.

## Data flow

```
GalaxyParams ──generateGalaxy──▶ Galaxy { systems: SystemStub[] }        (cheap, done first)
                                    │  user selects a system
                                    ▼
                          generateSystem(stub) ──▶ StarSystem             (cached by stub.id)
                                    │  user selects a planet
                                    ▼
                          detail panel reads Planet fields               (no new generation)
```

Planet **textures are not generated**: the planet shader turns `SurfaceSpec` into
pixels on the GPU, so a world costs a few uniform values, not a texture upload. That
is what lets the galaxy hold hundreds of systems without a memory ceiling.

## Rendering budget

Measured with `renderer.info` in the screenshot harness, on software GL (SwiftShader):

- galaxy view: **≤ 8 draw calls** (one point cloud for stars, one for dust, sprites
  batched), ≤ 400k points.
- system view: **≤ 120 draw calls**, ≤ 60k triangles. Belts are **point sprites, not
  instanced meshes**: a 1–2 px grain of dust is the only honest way to draw a belt at
  system scale, and it costs no triangles.
- planet view: **≤ 40 draw calls**, ≤ 120k triangles.
- no render target above 2048×2048 except the swapped post chain; total texture
  memory ≤ 256 MB.

Measured at `edf07ef`: galaxy 8 draws / 44k points · system 28 draws / 50.1k tris /
13.4k points · planet 10 draws / 36–46k tris. A seven-planet system with eight moons
reaches 49 draws / 113k tris — still inside the draw budget, above the old 60k
triangle line; that line described belts (now point sprites), not the whole frame.

**Screen-space floors and ceilings.** Planet, moon, star and ring sizes in the system
view are solved in SCREEN pixels every frame (`src/render/scales.ts`): planet discs are
5.5–14 px, moons cap at 0.34 of their planet's drawn radius, the star is floored at an
11 px photosphere with a 58 px corona, and ring annuli are capped at 2.6 planet radii.
Bodies are depth-sorted and their discs cannot overlap except at a true line-of-sight
conjunction, where the floors are wider than the separation; the nearer body occludes.
In short: planet radii are not drawn to scale at all; the inspector always shows the
true values.

## Failure behaviour

- No silent fallbacks (see `AGENTS.md`). A failed phase generation throws; the app
  shows the error and keeps the last good view. It never renders an empty universe
  and calls it success.
- WebGL2 absence is detected once, at boot, and stated in the UI — not swallowed.
- The app must keep working (panels, details) when the renderer is paused.

## Deliberately out of scope (for now)

- Multiplayer, persistence beyond the URL, accounts, sound.
- Real astrophysics where it costs the look: masses and temperatures are plausible,
  not simulated. Newtonian n-body dynamics are not modelled; orbits are Keplerian.
- Mobile-specific gesture design beyond "it must work and not trap the user".

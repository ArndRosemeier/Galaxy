# The board — what is happening right now

Galaxy's state of record. One screen, overwritten in place. Reconcile it against
reality with `bash scripts/board.sh` before dispatching anything; a record that no
longer describes the present belongs in the decision ledger or nowhere.

The record vocabulary and the contract live in the upstream doc
`/home/administrator/projects/Toolbox/docs/BOARD.md` — this file is the instance.

```
reconciled: 600dbcc · 2026-10-18T21:50Z

SESSION | id=session-f41732e8-880d-4c7b-8cf3-0a95aad20864 | model=deepseek-flash | state=DELIVERED — published, verified, no writers in flight

OWNER | away for a long stretch, 2026-10-18T19:52Z, verbatim: "I will not be here for a long time. I trust you to do this to completion." | decision policy: the dispatcher decides a fork itself, records the choice AND the rejected option in the ledger, and surfaces the decision in the final report when the owner returns

REQUEST | row=2 | A procedural galaxy creator in TS: planets, moons, asteroids, rings; zoom from the disc to a single world; detailed, pleasing, intuitive | src=ledger row 2 (owner's words verbatim)

LANDED | slice=sim | sha=072fe7c | verify=MY OWN: gate exit 0 (8 files / 83 tests), my injection ×1.05 gravity reddened the NAMED gravity pin then restored to green, my own cross-process SHA matched and another seed differed | worktree and session retired; branch deleted local+remote | docs=ledger 4,5,6; board | note=optional SystemContext added; system cache must key on the full stub
retired_branch=feat/sim
LANDED | slice=renderer | sha=7bf495f | verify=MY OWN: gate exit 0 (9 files / 90 tests), my own screenshots of galaxy/system/planet read, scope clean (src/sim, src/app, docs untouched) | worktree and session retired; branch deleted local+remote | note=info() within budget (galaxy 8 draws, system 50, planet 11); frames show the polish gaps now assigned
retired_branch=feat/render
LANDED | slice=integration | sha=c6dcbbb | verify=MY OWN: gate exit 0 (9 files / 90 tests), built app screenshots of all three views, zero console errors | dispatcher-owned | note=real generation drives the real renderer; state store, share-link codec and deep-system cache live

LANDED | slice=ui | sha=f7c9427 | verify=MY OWN: gate exit 0 (15 files / 117 tests), my own screenshots of home/system/planet/phone read, scope clean (only src/ui, tests/ui, append-only styles.css, 6-line main.ts mount) | worktree and session retired; branch deleted local+remote | docs=ledger 7,8; board | note=real-mouse e2e through data-testids (planet-row → planet, back → system, crumb → galaxy, play, speed, preset, randomize, copy); 8/8 QA clean
retired_branch=feat/ui
LANDED | slice=polish | sha=6d596bc | verify=MY OWN: gate exit 0 (15 files / 117 tests), my own frames of galaxy, system, ringed giant and an inhabited ocean world read | worktree and session retired; branch deleted local+remote | docs=ledger 9,10; board; ARCHITECTURE budget corrected | note=galaxy now reads as a photograph; ocean world fills the frame beautifully; my breadth survey found three NEW defects (planet crops at 900x600, rings dominate giants, planets overlap in wide-span systems)
retired_branch=feat/polish
LANDED | slice=polish2 | sha=edf07ef (cherry-picked from 9c1e7ba) | verify=MY OWN: gate exit 0 (15 files / 117 tests), my own frames at 1440x900 / 900x600 / 390x844 read, QA 9/9 clean | worktree and session retired; branch deleted local+remote | docs=ARCHITECTURE (screen-space ceilings); board | note=planet 10 draws / 36-46k tris; subject 58-60% of the shorter dimension at every aspect; rings soft and capped 2.6R; no body overlaps except true line-of-sight conjunctions
retired_branch=feat/polish2
LANDED | slice=ui-sheet-fix | sha=8047245 | verify=MY OWN: gate exit 0, phone and 900x600 frames read | dispatcher-owned | note=entering a world shows the world; the dossier sheet opens only when asked
LANDED | slice=publish | sha=fa6b8ca | verify=CONTENT: public page serves the exact built asset assets/index-TPhQ_sse.js (HTTP 200, cf-cache-status DYNAMIC), local host 200 for page and asset | note=https://apps.futuremagic.de/galaxy/ is live; hub refreshed; card enriched from public/futuremagic.json (hub index carries title, tagline, screenshot, tags)

QUEUE | none — the request is delivered. Next owner message is the next work order.
```

## State — verified, not believed (2026-10-18T21:06Z)

- **Remote:** `https://github.com/ArndRosemeier/Galaxy` — created by the owner, was
  empty when wired. Branch `main`, every landing pushed.
- **Stack:** TypeScript 7.0.2 · Vite 8.3.4 · three 0.186.1 · Vitest 5.0.5 · pnpm
  11.26.0 (shared store) · Node 24.21.0.
- **Gate:** `cheap = tsc --noEmit`, `full = vitest run && vite build`. Last run on
  `main`: **GREEN, exit 0 — 15 test files / 117 tests**. Raw log `.gate-logs/gate.log`.
- **Visual harness:** `tools/shoot.mjs` (headless Chrome + SwiftShader WebGL2, a
  static server, real clicks/wheels/keys, console-error capture, process-group kill in
  `finally`). `tools/qa.mjs` runs the scenario set and a real end-to-end click.
- **Testability limit, stated:** software GL cannot measure real-GPU frame rate.
  Correctness and looks are verified here; fps is the owner's machine's business.
- **Generation** (`072fe7c`): default 180-system galaxy → 605 planets, 757 moons, 95
  rings, 124 belts; spectral M 90 / K 40 / G 27 / F 14 / A 8 / B 1; kinds gas 167 ·
  desert 119 · ice 85 · barren 71 · icegiant 59 · toxic 50 · ocean 30 · terrestrial 15
  · lava 9; 7 living worlds (4 microbial, 1 flora, 1 fauna, 1 civilization).
  Determinism: same params → identical SHA-256 across processes; 1.6 ms for 180
  systems, 4.6 ms for 600.
- **Interface** (`f7c9427`): overlay legend, preset filmstrip, seed + share link,
  dossier inspector with human units, breadcrumb, transport dock, keyboard shortcuts,
  phone bottom sheet. Driven by real mouse events in QA.
- **Composition** (`6d596bc`): galaxy 8 draws / 42.9k points, system 28 draws, planet 12
  draws. The disc reads as a photograph; the ocean world fills the frame.
- **Open defects, assigned to `feat/polish2`:** planets crop at non-16:10 aspects,
  rings dominate ringed giants, drawn planets overlap in wide-span systems.
- **Overlay accepted** (ledger 10): panels sit over the scene; the free band at 1440 is
  nearly centred, so a lens shift would buy ~45 px.

DELIVERED | 2026-10-18T21:50Z | https://apps.futuremagic.de/galaxy/ | verify=pnpm verify: gate exit 0 (15 files / 117 tests, build 53 modules, bundle 732 kB / 197 kB gzip) then QA 9/9 clean (galaxy/system/planet at laptop and phone width, e2e click, e2e keys, an inhabited world found at runtime) | publish verified by CONTENT (same hashed asset on the public host), hub card enriched | no writers, no worktrees, no branches, lock free
HOST | the owner's 15-process browser tree observed at 19:21Z (pid 2996104) is gone at 21:50Z; no command in this session killed by pattern (the harness kills only its own process group), so it closed on its own or with the desktop session. The chrome processes seen during QA belong to `tools/shoot.mjs` and are reaped by it.

## Guards

- **`GUARD` — the suite lock.** `scripts/gate.sh` takes an atomic `mkdir` lock
  derived from the git common dir; a second run exits 9 and is VOID. Verified
  2026-10-18: concurrent runs → `0` / `9`, lock released.
- **`GUARD` — the reconciler.** `scripts/board.sh` re-derives the remote sha, claimed
  `LANDED` shas, the marker and `retired_branch=` claims; it says `CANNOT LOOK` or
  `BOARD STALE` rather than passing silently.
- **`GUARD` — the render budget.** `docs/ARCHITECTURE.md` fixes draw-call and point
  budgets per view; the screenshot harness reports `renderer.info` counts so a
  "looks fine" frame cannot hide a scene that will crawl on a real GPU.

## Recovery pointers

- Repo / remote / branch: `/home/administrator/projects/Galaxy` ·
  `https://github.com/ArndRosemeier/Galaxy` · `main`
- The gate: `bash scripts/gate.sh` — `0` green · `1` failed · `2` cheap only ·
  `9` refused, VOID
- Raw gate log: `.gate-logs/gate.log`
- Contract: `src/sim/types.ts` (frozen) · architecture: `docs/ARCHITECTURE.md` ·
  test doctrine: `docs/TESTING.md`
- Visual check: `node tools/shoot.mjs --serve dist --url / --out shots/x.png`
- Writers: `git worktree list` · `git branch -a`

## Traps

- `TRAP` — a census command can lie in the flattering direction. `ps -eo
  pid,etime,comm=` grepped for `^(vitest|…)` matches nothing because the line begins
  with a PID. Rule: match the command column or count by `comm`, and trust "nothing
  found" only once the pattern is known to be able to match something.
- `TRAP` — reaping `chrome` by pattern on this host kills the owner's GUI. The
  browser predates every session and is the operator's. Rule: audit only processes
  you started, by parent PID and start time.
- `TRAP` — a check whose scaffolding failed still reports a plausible verdict. Two
  gate runs once "failed" because the shell could not create their redirect targets;
  gate.sh never ran. Rule: prove the check RAN before reading its exit code.

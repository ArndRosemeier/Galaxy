# The board — what is happening right now

Galaxy's state of record. One screen, overwritten in place. Reconcile it against
reality with `bash scripts/board.sh` before dispatching anything; a record that no
longer describes the present belongs in the decision ledger or nowhere.

The record vocabulary and the contract live in the upstream doc
`/home/administrator/projects/Toolbox/docs/BOARD.md` — this file is the instance.

```
reconciled: 072fe7c · 2026-10-18T19:54Z

SESSION | id=session-f41732e8-880d-4c7b-8cf3-0a95aad20864 | model=deepseek-flash | state=working autonomously — owner away

OWNER | away for a long stretch, 2026-10-18T19:52Z, verbatim: "I will not be here for a long time. I trust you to do this to completion." | decision policy: the dispatcher decides a fork itself, records the choice AND the rejected option in the ledger, and surfaces the decision in the final report when the owner returns

REQUEST | row=2 | A procedural galaxy creator in TS: planets, moons, asteroids, rings; zoom from the disc to a single world; detailed, pleasing, intuitive | src=ledger row 2 (owner's words verbatim)

LANDED | slice=sim | sha=072fe7c | verify=MY OWN: gate exit 0 (8 files / 83 tests), my injection ×1.05 gravity reddened the NAMED gravity pin then restored to 8/8 green, my own cross-process SHA 87df6c64… matched and another seed f4de6ba0… differed | worktree and session retired; branch feat/sim deleted local+remote | docs=ledger 4,5; board | note=added optional SystemContext to the contract; a system cache must be cleared on regeneration
retired_branch=feat/sim
IN-FLIGHT | slice=renderer | session=8679b07f-696f-4779-9ca1-be76c3aa3bf1 | worktree=/home/administrator/projects/Galaxy/worktrees/renderer | branch=feat/render | base=5c75da5 | state=writing | scope=src/render/** + lab.html + dev fixtures; renders the frozen contract, generates nothing

QUEUE | row=3 | integration: mount real generation + renderer in main.ts, app state, selection, three views, transitions | src=docs/ARCHITECTURE.md
QUEUE | row=4 | UI: parameter panel, inspector, presets, seed/share URL, time controls, keyboard, responsive layout | src=docs/ARCHITECTURE.md
QUEUE | row=5 | visual polish: deepen galaxy/system/planet frames against the owner's bar; phone + laptop | src=docs/TESTING.md
QUEUE | row=6 | QA and publish: full gate, screenshots of every view, docs, static build reachable at a URL | src=docs/TESTING.md
```

## State — verified, not believed (2026-10-18T19:54Z)

- **Remote:** `https://github.com/ArndRosemeier/Galaxy` — created by the owner, was
  empty when wired (`git ls-remote --heads` printed nothing). Branch `main`.
- **Stack:** TypeScript 7.0.2 · Vite 8.3.4 · three 0.186.1 · Vitest 5.0.5 · pnpm
  11.26.0 (shared store). Node 24.21.0.
- **Gate:** `cheap = tsc --noEmit`, `full = vitest run && vite build`. Last run:
  **GREEN, exit 0** — 7/7 tests, build 5 modules, raw log `.gate-logs/gate.log`.
- **Visual harness:** `tools/shoot.mjs` verified end to end — headless Chrome +
  SwiftShader WebGL2, screenshot captured and read back, page clean, Chrome tree
  reaped (owner's 15-process browser untouched).
- **Testability limit, stated:** SwiftShader cannot measure real-GPU frame rate.
  Correctness and looks are verifiable here; fps is the owner's machine's business.

- **Simulation landed** (`072fe7c`): default 180-system galaxy → 605 planets, 757
  moons, 95 rings, 124 belts; spectral classes M 90 / K 40 / G 27 / F 14 / A 8 / B 1;
  kinds gas 167 · desert 119 · ice 85 · barren 71 · icegiant 59 · toxic 50 · ocean 30 ·
  terrestrial 15 · lava 9; 7 living worlds (4 microbial, 1 flora, 1 fauna, 1
  civilization). Generation: 1.6 ms for 180 systems, 4.6 ms for 600.

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

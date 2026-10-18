# The board — what is happening right now

Galaxy's state of record. One screen, overwritten in place. Reconcile it against
reality with `bash scripts/board.sh` before dispatching anything; a record that no
longer describes the present belongs in the decision ledger or nowhere.

The record vocabulary and the contract live in the upstream doc
`/home/administrator/projects/Toolbox/docs/BOARD.md` — this file is the instance.

```
reconciled: 5c75da5 · 2026-10-18T19:40Z

SESSION | id=session-f41732e8-880d-4c7b-8cf3-0a95aad20864 | model=deepseek-flash | state=waiting on two writers

REQUEST | row=2 | A procedural galaxy creator in TS: planets, moons, asteroids, rings; zoom from the disc to a single world; detailed, pleasing, intuitive | src=ledger row 2 (owner's words verbatim)

IN-FLIGHT | slice=sim | session=0e571d68-9bb7-45a7-8f4a-4e142bd2ac3d | worktree=/home/administrator/projects/Galaxy/worktrees/sim | branch=feat/sim | base=5c75da5 | state=writing | scope=src/sim/** (rng, noise, naming, galaxy, system, params, presets, index) + tests/sim/**; types.ts and orbit.ts frozen
IN-FLIGHT | slice=renderer | session=8679b07f-696f-4779-9ca1-be76c3aa3bf1 | worktree=/home/administrator/projects/Galaxy/worktrees/renderer | branch=feat/render | base=5c75da5 | state=writing | scope=src/render/** + lab.html + dev fixtures; renders the frozen contract, generates nothing

QUEUE | row=3 | integration: mount sim + renderer in main.ts, wire selection and the three views | src=docs/ARCHITECTURE.md
QUEUE | row=4 | UI: parameter panel, inspector, presets, share URL, keyboard | src=docs/ARCHITECTURE.md
QUEUE | row=5 | polish + visual QA against the owner's bar; publish the build | src=docs/TESTING.md
```

## State — verified, not believed (2026-10-18T19:40Z)

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

# The decision ledger — Galaxy

**Append-only.** A decision is history; history never rots. Never edit another
landing's row — if a decision is superseded, add a new row that says so and points
at the old one.

**This is not a behaviour doc.** Docs that *restate behaviour* rot; docs that
*record decisions* do not. Behaviour lives in a test (the test **is** the
statement); this file holds the decision, the reason, and the pointer to the test.

## The rule for a row

1. **Quote the owner verbatim** when the decision is theirs. The verbatim words are
   what stops a later slice from re-litigating it.
2. **Name the evidence** — the file:line, the measurement, the incident — at the
   commit it was true.
3. **Say what was rejected**, and why. A decision without its rejected alternative
   gets re-proposed.
4. **Say what is still unproven.** An honest unknown is worth more than a confident
   guess.

## Row numbers are assigned by the dispatcher

The dispatcher reads this file at brief time and puts the row number **in the
brief**, so two concurrent writers cannot claim the same one. A writer that still
hits a docs conflict renumbers its OWN row only and touches nothing of the other
landing.

---

## Ledger

| n | statement | files | why | status |
| ---: | --- | --- | --- | --- |
| 1 | **Galaxy adopts the shared process on day 1, before any code exists** — owner, verbatim: *"please be my chief of staff"*. Evidence: `~/projects/Galaxy` was an empty, non-git directory at 2026-10-18T19:21Z (`ls -la`); the Toolbox scaffold is the upstream. Rejected: bootstrapping after the first feature, because every dispatch presupposes a record, a gate and a brief, and a session can die before that feature exists. Unproven: the stack and the first slice — the owner has not stated them. | `AGENTS.md`, `docs/BOARD.md`, `docs/BRIEF.md`, `scripts/gate.sh`, `scripts/board.sh` | a session death must be survivable from day 1 | LANDED 8b5c254 |
| 2 | **A procedural galaxy creator in the browser, TypeScript, three.js, generated from a seed** — owner, verbatim: *"This is meant to be a galaxy creator in TS. Complete with planets, moons, asteroids and everything else you can imagine … This of course needs to be procedural with parameters given and usefull defaults selected. … The user should be able to zoom in on any place and get a nice view and details. … The end result needs to look pleasing, needs to be very easy to understand and intuitive to work with, with all the bells and whistles you can give it."* Decision: Vite + three.js + Vitest; generation is pure and seeded (`src/sim`), rendering is three.js over the frozen contract (`src/sim/types.ts`), surfaces are shader recipes (`SurfaceSpec`) rather than generated textures. Rejected: raw WebGL2 (control, but weeks of plumbing before the first good frame — the showpiece is the scene, not the renderer); Canvas 2D (cannot hold a lit, textured planet at this quality); per-planet texture generation (memory ceiling and upload cost grow with the galaxy; shaders cost uniforms). Unproven: real-GPU frame rate — this host only has software GL; taste is the owner's. | `src/`, `docs/ARCHITECTURE.md` | the owner's showpiece: depth of generation, quality of frame, ease of use | LANDED pending integration |
| 3 | **The GitHub remote is the owner's, created by him; the session wires and pushes to it** — owner, verbatim: *"I made an empty repo here: https://github.com/ArndRosemeier/Galaxy. Use that for your work."* Evidence: repo empty on `git ls-remote` at 2026-10-18T19:30Z, `origin` wired, pushes land on `main`. Rejected: creating the repo from this session (it is the owner's account and name; he had already made it). | `.git/config` | remote reconciliation, durable record | LANDED |

<!--
Copy the row above for each new decision. Keep it to one row's worth of prose: the
detail belongs in the commit, the test, or the seam index — this is the pointer.
-->

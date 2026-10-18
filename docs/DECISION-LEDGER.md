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
| 1 | **Galaxy adopts the shared process on day 1, before any code exists** — owner, verbatim: *"please be my chief of staff"*. Evidence: `~/projects/Galaxy` was an empty, non-git directory at 2026-10-18T19:21Z (`ls -la`); the Toolbox scaffold is the upstream. Rejected: bootstrapping after the first feature, because every dispatch presupposes a record, a gate and a brief, and a session can die before that feature exists. Unproven: the stack and the first slice — the owner has not stated them. | `AGENTS.md`, `docs/BOARD.md`, `docs/BRIEF.md`, `scripts/gate.sh`, `scripts/board.sh` | a session death must be survivable from day 1 | LANDED PENDING |

<!--
Copy the row above for each new decision. Keep it to one row's worth of prose: the
detail belongs in the commit, the test, or the seam index — this is the pointer.
-->

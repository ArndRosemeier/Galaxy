# The board — what is happening right now

Galaxy's state of record. One screen, overwritten in place. Reconcile it against
reality with `bash scripts/board.sh` before dispatching anything; a record that no
longer describes the present belongs in the decision ledger or nowhere.

The record vocabulary and the contract live in the upstream doc
`/home/administrator/projects/Toolbox/docs/BOARD.md` — this file is the instance.

```
reconciled: 8b5c254 · 2026-10-18T19:26Z

SESSION | id=session-f41732e8-880d-4c7b-8cf3-0a95aad20864 | model=deepseek-flash | state=idle — awaiting the owner's first work order

QUEUE | row=2 | choose the stack and the first slice — owner's call; nothing can be dispatched before it | src=this file
QUEUE | row=3 | create the GitHub repo + remote; board.sh cannot reconcile against a remote until it exists | src=this file

RECOVERY | repo=/home/administrator/projects/Galaxy | remote=NONE — not created | branch=main | gate=bash scripts/gate.sh
```

## State — verified, not believed (2026-10-18T19:23Z)

- **The repo started empty.** `~/projects/Galaxy` held no files and no `.git` at
  session start (21:21 local); it is now a git repo on `main` with no commits
  before the bootstrap commit.
- **No remote.** There is no `origin`; `board.sh` therefore reports
  `CANNOT LOOK` (exit 1) — the correct, loud behaviour for a check that cannot see
  reality, not a stale record.
- **The gate is UNCONFIGURED and RED by design.** `scripts/gate.sh` fails loudly
  (exit 1) until `GATE_CHEAP_CMD` / `GATE_FULL_CMD` match a real stack. It must not
  pass a check that checks nothing.
- **Host:** load 0.07; no suite processes; no gate lock held.
- **The 15 `chrome` processes on this host are the owner's browser** (one
  `/opt/google/chrome/chrome` tree, browser pid 2996104, up to ~8.5 days old) — they
  render the Web GUI at `127.0.0.1:3080`. They are NOT this session's orphans. See
  `AGENTS.md` §Host hygiene 8.

## Guards

- **`GUARD` — the suite lock.** `scripts/gate.sh` takes an atomic `mkdir` lock
  derived from the git common dir (one lock across every worktree); a second run is
  refused with exit 9 and is VOID. Verify: run a full gate twice. **Verified
  2026-10-18:** two concurrent runs — first GREEN `exit 0`, second `exit 9` with
  `REFUSED … VOID`, lock released by its owner afterwards.
- **`GUARD` — the reconciler.** `scripts/board.sh` re-derives the remote sha, every
  claimed `LANDED` sha, the `reconciled:` marker and every `retired_branch=` claim,
  and reports `BOARD STALE` (exit 1) or `CANNOT LOOK` (exit 1) rather than passing
  silently. Verify: run it after any record edit. **Verified 2026-10-18:** with no
  remote it printed `CANNOT LOOK` and `exit 1`.

## Recovery pointers

- Repo / remote / branch: `/home/administrator/projects/Galaxy` · **no remote yet**
  · `main`
- The gate and its exit codes: `bash scripts/gate.sh` — `0` green · `1` failed ·
  `2` cheap tier only · `9` refused, VOID
- Raw gate logs: `.gate-logs/gate.log` (gitignored)
- Writers: at most two, each in `<repo>/worktrees/<slice>` on its own branch;
  `git worktree list` and `git branch -a` are the census
- The process itself: `/home/administrator/projects/Toolbox/docs/WAY-OF-WORKING.md`

## Traps

- `TRAP` — a census command can lie in the flattering direction. `ps -eo pid,etime,comm=`
  grepped for `^(vitest|…)` matches nothing, because the line begins with the PID, so
  "no suite processes" was momentarily unproven (measured 2026-10-18, this session).
  Rule: match the COMMAND COLUMN or count by `comm`, and treat "nothing found" as a
  result only once the pattern is known to be able to match something.
- `TRAP` — reaping `chrome` by pattern on this host kills the owner's GUI. The
  browser predates the session and is the operator's. Rule: audit only processes you
  started, by parent PID and start time; a browser you start dies in a `trap`.
- `TRAP` — a check whose scaffolding failed reports a plausible-looking verdict.
  Measured 2026-10-18, this session: the lock test redirected each run's output into
  `.gate-logs/t1/out.txt` and `.gate-logs/t2/out.txt` before those directories
  existed, so BOTH shells exited 1 without gate.sh ever running — two "RED" results
  that were the harness's, not the gate's. Rule: prove the check RAN (its own banner
  / log) before reading its exit code, and create a redirect target before
  redirecting into it.

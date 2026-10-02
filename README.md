# fly — a fruit-fly connectome learns poker

Built as a booth exhibit for a CS club fair. The wiring is the MaleCNS v1.0
connectome (166,700 neurons, CC-BY, FlyEM/Janelia + Cambridge + Google), frozen. Game state drives
its sensory neurons; a trained readout over its 1,316 descending neurons picks fold / call / raise.
The brain never changes — only how we listen to it does.

Controls: `shuffled` (same neurons and synapse counts, targets randomly rewired) and `nobrain`
(the same readout on the raw inputs). If the real fly doesn't beat the shuffled one, that's the result.

All commands run from the repo root. First time here? See [One-time setup](#one-time-setup).

## Resume training

Each arm runs in its own tmux session, `fly-<arm>`. `run.sh` resumes from `runs/<arm>/ckpt/latest.npz`
and restarts the trainer if it crashes. Use the same operational flags as the last launch (they are
recorded in each `log.jsonl` line):

    FLY_OPS="--kernel mps --throttle 0" tmux new -d -s fly-real     './run.sh real'
    FLY_OPS="--kernel mps --throttle 0" tmux new -d -s fly-shuffled './run.sh shuffled'
    FLY_OPS="--throttle 28"             tmux new -d -s fly-nobrain  './run.sh nobrain'

`nobrain` has no connectome to run, so it gets no kernel flag. It is throttled to roughly match the
~28 hands/s of the other two arms.

Check that the trainers came back up:

    tmux ls | grep fly-                      # three sessions
    tail -3 runs/real.out                    # should say "resumed at N hands"
    pmset -g assertions | grep caffeinate    # Mac is being kept awake

A resume goes back to the last checkpoint (taken every 2,000 hands). Log lines written after that
checkpoint are dropped, and the RNG state is restored, so nothing is double-counted.

## Everyday commands

    # progress: hands played and speed, per arm
    for a in real shuffled nobrain; do printf '%-9s' $a; tail -1 runs/$a/log.jsonl | cut -d, -f1,3; done

    tail -f runs/real.out                    # live trainer output (crashes, restarts)
    tmux attach -t fly-real                  # watch a session; detach with Ctrl-b d
    tmux kill-session -t fly-real            # stop an arm (safe: checkpoints are written atomically)

To stop everything: `for a in real shuffled nobrain; do tmux kill-session -t fly-$a; done`.

### Operational flags (`FLY_OPS`, re-read on every restart)

| Flag | Effect |
|---|---|
| `--kernel csr\|skip\|mps` | How the connectome multiply runs. `mps` is the Apple GPU, `skip` skips silent neurons on the CPU. Both are faster than `csr` and differ from it only by float32 rounding |
| `--throttle N` | Max hands/s, overriding the config's 10. `0` = unthrottled |
| `--threads N` | CPU threads for the multiply (`csr`/`skip`) |
| `--hands N` | Stop after N total hands |

These change speed only. You can change them between restarts without affecting the model.

## Rules

- **A run's config is frozen when the run is created.** On resume, the trainer refuses `--arm` or
  `--set`. To try a different learning rate, gain, etc., start a **new** run directory. Never edit
  `config.json`.
- Eval and new opponents get added later by **replaying `runs/<arm>/snapshots/`**, never by changing
  a live run. Snapshots are kept from hand 0 for exactly this reason.
- `caffeinate -is` keeps the Mac awake only while it's plugged in. On battery, the lid or idle sleep
  pauses training.
- Don't launch with `taskpolicy -b` (background priority). `taskpolicy -B -p` can't undo it: the
  command exits 0, but the process stays at priority 4. Restart the arm instead.

## Start a new run

    ./run.sh real --set lr=3e-4      # creates runs/real if it doesn't exist; --set applies only then

`run.sh` names the run directory after the arm, so it only makes `runs/real`, `runs/shuffled` and
`runs/nobrain`. For a side experiment under a different name, call the trainer directly. It resumes
the same way if you run it again without `--arm`/`--set`:

    uv run python -m flypoker.train runs/pilot/real-gain0.8 --arm real --set brain='{"gain":0.8}' --hands 200000

`runs/pilot/` holds the learning-rate sweep the live runs were chosen from. It is not resumed.

## Evaluate snapshots

Duplicate-deal evaluation: every deal is played twice with seats swapped, so card luck cancels out.
Results are appended to `runs/<arm>/eval.jsonl`, and snapshots already evaluated are skipped, so it's
safe to re-run.

    uv run python -m flypoker.evaluate runs/real --pairs 2000 --every 5
    uv run python -m flypoker.evaluate runs/real --opponents equity,maniac

300 pairs gives roughly ±700 bb/100. You need about 2,000 pairs per point to tell the arms apart.

## Fair display

`flypoker.server` plays paced exhibition hands with the latest `real` snapshot. It streams them to the
browser and shows live training stats from the `log.jsonl` files. It only reads from runs.

    (cd web && pnpm install && pnpm build)   # once, or after changing web/src
    uv run python -m flypoker.server         # http://localhost:8765  (--arm shuffled, --port N)

To work on the frontend with hot reload, keep the server running and also run `(cd web && pnpm dev)`.
Vite proxies `/api` and `/ws` to port 8765.

## One-time setup

    uv sync
    uv run pytest

The connectome isn't downloaded by code. It's three public feathers (~1.1 GB) from
`https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome/`. Put these in
`data/`:

- `connectome-weights-male-cns-v1.0-minconf-0.5.feather`
- `body-annotations-male-cns-v1.0-minconf-0.5.feather`
- `body-neurotransmitters-male-cns-v1.0.feather`

Then build the derived files:

    uv run python -m flypoker.data           # -> data/brain.npz (signed edge list)
    uv run python -m flypoker.positions      # -> data/positions.npz (for the display)

## Run directory layout

    runs/<arm>/config.json      frozen at creation (includes git commit and connectome sha256)
    runs/<arm>/log.jsonl        one line per 2,000 hands: bb/100 per opponent, entropy, action mix, speed
    runs/<arm>/ckpt/latest.npz  full training state, used to resume
    runs/<arm>/snapshots/       readout only, every 10,000 hands, for eval replay and the display
    runs/<arm>/eval.jsonl       written by flypoker.evaluate
    runs/<arm>.out              everything the trainer and run.sh printed

## Data & license

Code: MIT (see `LICENSE`). The MaleCNS v1.0 connectome is CC-BY, by FlyEM (HHMI Janelia), the
University of Cambridge and Google; it is downloaded from their public bucket, not redistributed
in this repo.

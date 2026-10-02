# fly — a fruit-fly connectome learns poker

Built as a booth exhibit for a CS club fair. The wiring is the MaleCNS v1.0
connectome (166,700 neurons, CC-BY, FlyEM/Janelia + Cambridge + Google), frozen. Game state drives
its sensory neurons; a trained readout over its 1,316 descending neurons picks fold / call / raise.
The brain never changes — only how we listen to it does.

Controls: `shuffled` (same neurons and synapse counts, targets randomly rewired) and `nobrain`
(the same readout on the raw inputs). If the real fly doesn't beat the shuffled one, that's the result.

All commands run from the repo root. First time here? See [One-time setup](#one-time-setup).

## Running it: `./fly`

One script runs the experiment. Each arm trains in its own tmux session (`fly-real`, `fly-shuffled`,
`fly-nobrain`), and a watcher (`fly-watch`) keeps an eye on everything.

    ./fly up                    # start (or resume) all three arms and the watcher
    ./fly status                # hands, speed, last log, snapshot, booth screen, publishing, battery
    ./fly down                  # stop everything, on purpose (no alerts)
    ./fly up real               # or one arm at a time; ./fly down nobrain
    ./fly speed fast --until 15:00   # train flat out, then back to calm at 3 PM
    ./fly speed calm            # 10 hands/s per arm: the machine stays usable
    ./fly display               # the booth screen, in tmux fly-display, opened in the browser
    ./fly publish               # push the real fly's newest snapshots to the site now

`run.sh` resumes from `runs/<arm>/ckpt/latest.npz` and restarts a crashed trainer. A resume goes back
to the last checkpoint (every 2,000 hands); log lines after it are dropped and the RNG state is
restored, so nothing is double-counted.

**The watcher** checks once a minute and sends a macOS banner when:
- a run stops (its session is gone), stalls (no log line for 10 minutes), restarts, or crash-loops;
- the booth screen dies while it's meant to be up;
- the battery reaches 20% or 10% while unplugged;
- it publishes to the site (every 50,000 hands of the real arm; `./fly watch --every N`, or
  `FLY_PUBLISH_EVERY`), or a publish or deploy fails.

Stopping with `./fly down` is quiet; anything else that stops a run is an alert. Banners are also
logged to `runs/.fly/notify.log`.

**Battery:** training keeps going unplugged (`caffeinate -dis` blocks idle sleep and keeps the
screen on), but **closing the lid on battery sleeps the Mac** and pauses training.

Each arm's speed flags live in `runs/<arm>/ops` (written by `./fly up` and `./fly speed`).

    tail -f runs/real.out                    # live trainer output (crashes, restarts)
    tmux attach -t fly-real                  # watch a session; detach with Ctrl-b d

### Fair day

    ./fly up && ./fly display   # train, and put the booth screen up (it plays the newest snapshot)

Keep the lid open. If a banner says a run stopped, `./fly up <arm>` brings it back.

### Operational flags (`runs/<arm>/ops`, re-read on every restart)

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
Open `/fair.html` on the Vite dev server; Vite proxies `/api` and `/ws` to port 8765.

## Public site (play the fly)

`web/index.html` is the public page: visitors play heads-up against the fly, entirely in the browser
(the engine in `web/src/engine/` is a port checked against Python golden cases by `pnpm test`).
`web/fair.html` is the booth display above. GitHub Pages deploys on every push to `main` that touches
`web/` (`.github/workflows/pages.yml`).

- Packed connectomes and neuron positions are assets on the `data-v1` GitHub Release, not git files.
  Rebuild them with `uv run python tools/pack_connectome.py` and `uv run python tools/export_site_data.py`
  (outputs in `web/public/data/`).
- Readout snapshots live on the `site-data` branch: one commit, force-pushed by `./fly publish`
  (from the `.publish/` worktree), which then dispatches the Pages workflow. `main` stays code-only.
  For local builds, `uv run python tools/export_snapshots.py` writes them into `web/public/snapshots/`.
- Locally: `(cd web && pnpm build && pnpm exec vite preview)` once `web/public/data/` exists.

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

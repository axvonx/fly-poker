#!/usr/bin/env bash
# Train one arm forever, restarting after crashes, keeping the Mac (and its screen) awake.
# caffeinate -i blocks idle sleep on battery too; closing the lid on battery still sleeps.
#
#   ./run.sh real [--set lr=1e-3 ...]    # extra args only apply when the run is first created
#   FLY_OPS="--threads 3 --throttle 0" ./run.sh real   # operational flags, applied on every (re)start
#   tmux new -d -s fly-real './run.sh real'
#
# Gives up after 5 crashes within a minute of starting each (a crash loop, not a hiccup).
set -u
cd "$(dirname "$0")"
arm=$1
shift
run=runs/$arm
mkdir -p runs
fails=0
while [ "$fails" -lt 5 ]; do
  if [ -f "$run/config.json" ]; then
    args=("$run")
  else
    args=("$run" --arm "$arm" "$@")
  fi
  start=$(date +%s)
  # shellcheck disable=SC2086
  caffeinate -dis uv run python -m flypoker.train "${args[@]}" ${FLY_OPS:-} 2>&1 | tee -a "$run.out"
  if [ $(( $(date +%s) - start )) -lt 60 ]; then fails=$((fails + 1)); else fails=0; fi
  echo "[run.sh] trainer exited at $(date); restarting in 10s (quick failures: $fails)" | tee -a "$run.out"
  sleep 10
done
echo "[run.sh] giving up: crash loop" | tee -a "$run.out"

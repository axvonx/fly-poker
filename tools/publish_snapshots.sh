#!/usr/bin/env bash
# Publish the newest training snapshots to the public site: re-export the curated, log-spaced
# set (plus the training chart), commit, push. The push to main redeploys GitHub Pages.
# Read-only on runs/. Run from anywhere; safe to run while training.
set -euo pipefail
cd "$(dirname "$0")/.."

uv run python tools/export_snapshots.py
git add web/public/snapshots
if git diff --cached --quiet; then
  echo "No new snapshots to publish."
  exit 0
fi
latest=$(python3 -c 'import json; print(json.load(open("web/public/snapshots/manifest.json"))["arms"]["real"]["snapshots"][-1]["hands"])')
git commit -m "Publish snapshots through hand ${latest}"
git push

"""Copy a log-spaced subset of each arm's readout snapshots into the site.

    uv run python tools/export_snapshots.py [--runs DIR] [--out DIR] [--points N]

Writes web/public/snapshots/<arm>/h<hands>.f32, manifest.json, and training.json (the real fly's
training log, for the page's chart). Each .f32 is
little-endian float32: W (dim x 5, row-major), b (5), mu (dim), sd (dim). Read-only on runs/.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
ARMS = ("real", "shuffled", "nobrain")


def pick(hands: list[int], points: int) -> list[int]:
    """Hand 0, the latest, and the snapshots nearest to log-spaced targets in between."""
    hands = sorted(hands)
    chosen = {hands[0], hands[-1]}
    trained = [h for h in hands if h > 0]
    if trained:
        for t in np.geomspace(trained[0], trained[-1], points):
            chosen.add(min(trained, key=lambda h: abs(np.log(h) - np.log(t))))
    return sorted(chosen)


def snapshot_bytes(path: Path) -> tuple[bytes, int]:
    z = np.load(path)
    W, b, mu, sd = (z[k].astype("<f4") for k in ("W", "b", "mu", "sd"))
    dim = W.shape[0]
    assert W.shape == (dim, 5) and b.shape == (5,) and mu.shape == (dim,) and sd.shape == (dim,)
    return W.tobytes() + b.tobytes() + mu.tobytes() + sd.tobytes(), dim


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=Path, default=ROOT / "runs")
    ap.add_argument("--out", type=Path, default=ROOT / "web" / "public" / "snapshots")
    ap.add_argument("--points", type=int, default=12, help="log-spaced targets per arm")
    args = ap.parse_args()
    manifest = {"generated": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "arms": {}}
    for arm in ARMS:
        snaps = {int(p.stem[1:]): p for p in (args.runs / arm / "snapshots").glob("h*.npz")}
        if not snaps:
            continue
        (args.out / arm).mkdir(parents=True, exist_ok=True)
        entries, dim = [], None
        for h in pick(list(snaps), args.points):
            data, dim = snapshot_bytes(snaps[h])
            name = f"{arm}/h{h:09d}.f32"
            (args.out / name).write_bytes(data)
            entries.append({"hands": h, "file": name})
        manifest["arms"][arm] = {"dim": dim, "snapshots": entries}
        print(f"{arm}: {len(entries)} snapshots, latest {entries[-1]['hands']:,} hands")
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    write_training(args.runs / "real" / "log.jsonl", args.out / "training.json")


def write_training(log: Path, out: Path, max_points: int = 240) -> None:
    """The real fly's training log, thinned, for the page's winnings chart.

    bb100 per bot is in big blinds per 100 hands; at the page's $1 big blind that is also
    dollars per 100 hands.
    """
    rows = [json.loads(ln) for ln in log.read_text().splitlines()]
    step = max(1, len(rows) // max_points)
    series = [
        {"hands": r["hands"], "bb100": {k: round(v, 1) for k, v in r["bb100"].items()}}
        for r in rows[::-1][::step][::-1]
    ]
    out.write_text(json.dumps({"series": series}) + "\n")
    print(f"training: {len(series)} points")


if __name__ == "__main__":
    main()

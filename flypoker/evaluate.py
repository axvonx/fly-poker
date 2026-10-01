"""Duplicate-deal evaluation: every deal is played twice with seats swapped, so card luck
cancels and what remains is skill. Reports big blinds won per 100 hands with a 95% CI.
"""

from __future__ import annotations

import numpy as np

from flypoker.agent import play_batch
from flypoker.poker import shuffled_deck

EVAL_SEED = 1_000_000_007  # deals used for eval never overlap training deals


def duplicate(agent, opponent, pairs: int, seed0: int = EVAL_SEED, batch: int = 32) -> dict:
    scores = []
    for lo in range(0, pairs, batch):
        ks = range(lo, min(lo + batch, pairs))
        decks = [shuffled_deck(seed0 + k) for k in ks]
        seeds = [seed0 + k for k in ks]
        opp = [opponent] * len(decks)
        a, _ = play_batch(agent, decks, [0] * len(decks), opp, seeds)
        b, _ = play_batch(agent, decks, [1] * len(decks), opp, seeds)
        scores.append((a + b) / 2)
    s = np.concatenate(scores)
    return {
        "bb100": float(s.mean() * 100),
        "ci95": float(1.96 * s.std(ddof=1) / np.sqrt(len(s)) * 100) if len(s) > 1 else float("nan"),
        "pairs": len(s),
    }


def replay(run, opponents, pairs: int, every: int = 1) -> None:
    """Evaluate every not-yet-evaluated snapshot of a run; append results to eval.jsonl.

    The ladder can be fixed after training starts: snapshots are kept from hand 0.
    """
    import json
    from pathlib import Path

    from flypoker.bots import LADDER
    from flypoker.train import TrainConfig, load_snapshot, make_fly

    run = Path(run)
    cfg = TrainConfig(**json.loads((run / "config.json").read_text())["train"])
    out = run / "eval.jsonl"
    done = set()
    if out.exists():
        done = {(r["hands"], r["opponent"], r["pairs"]) for r in map(json.loads, out.open())}
    fly = make_fly(cfg)
    for snap in sorted((run / "snapshots").glob("h*.npz"))[::every]:
        hands = int(snap.stem[1:])
        fly.readout = load_snapshot(snap)
        for name in opponents:
            if (hands, name, pairs) in done:
                continue
            r = duplicate(fly, LADDER[name], pairs) | {"hands": hands, "opponent": name}
            with out.open("a") as f:
                f.write(json.dumps(r) + "\n")
            print(json.dumps(r), flush=True)


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("run")
    ap.add_argument("--opponents", default="random,station,maniac,equity")
    ap.add_argument("--pairs", type=int, default=500)
    ap.add_argument("--every", type=int, default=1, help="evaluate every k-th snapshot")
    a = ap.parse_args()
    replay(a.run, a.opponents.split(","), a.pairs, a.every)

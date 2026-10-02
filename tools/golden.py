"""Golden cases for the browser engine: the Python reference, recorded.

    uv run python tools/golden.py [--data DIR] [--runs DIR]

Writes web/test/golden/:
  rules.json    hands between ladder bots: every decision's observation and the final payoffs
  hands.json    poker hand categories (made_hand) for random hole/board combinations
  readouts/     the snapshots fly.json uses, as <arm>-<snapshot>.f32 (see export_snapshots.py)
  fly.json      the fly playing ladder bots for a few snapshots: features, descending rates
                (a fixed sample), and action probabilities at every fly decision

The fly cases use the reference csr kernel. Each hand starts from a silent brain, and the
brain's state carries over between the fly's decisions within the hand, as in training.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from flypoker.agent import Readout  # noqa: E402
from flypoker.bots import LADDER  # noqa: E402
from flypoker.brain import Brain, BrainConfig  # noqa: E402
from flypoker.data import load  # noqa: E402
from flypoker.features import N_FEATURES, encode  # noqa: E402
from flypoker.poker import DECK, N_ACTIONS, Hand, Obs, made_hand, shuffled_deck  # noqa: E402
from flypoker.train import load_snapshot  # noqa: E402
from tools.export_snapshots import snapshot_bytes  # noqa: E402

OUT = ROOT / "web" / "test" / "golden"
DESC_SAMPLE = 48  # descending neurons recorded per decision (evenly spaced)


def f(x) -> float:
    return float(f"{float(x):.8g}")


def obs_json(o: Obs) -> dict:
    return {
        "seat": o.seat, "hole": o.hole, "board": o.board, "street": o.street, "pot": o.pot,
        "to_call": o.to_call, "stack": o.stack, "opp_stack": o.opp_stack,
        "history": [list(h) for h in o.history], "legal": [bool(v) for v in o.legal],
    }


def rules_cases(n_hands: int) -> list[dict]:
    names = list(LADDER)
    out = []
    for i in range(n_hands):
        seed = 10_000 + i
        deck = shuffled_deck(seed)
        bots = [LADDER[names[i % 4]], LADDER[names[(i // 4) % 4]]]
        rngs = [np.random.default_rng((seed, 0)), np.random.default_rng((seed, 1))]
        h = Hand(deck)
        steps = []
        while not h.done:
            o = h.obs()
            a = int(bots[o.seat](o, rngs[o.seat]))
            steps.append({"obs": obs_json(o), "action": a})
            h.act(a)
        board = [f"{c[0].rank}{c[0].suit}" for c in h.state.board_cards]
        out.append({"deck": deck[:12], "steps": steps, "board": board, "payoffs": list(h.payoffs)})
    return out


def hand_cases(n: int) -> list[dict]:
    rng = np.random.default_rng(7)
    out = []
    for i in range(n):
        k = (0, 3, 4, 5)[i % 4]
        cards = [DECK[j] for j in rng.permutation(52)[: 2 + k]]
        out.append({"hole": cards[:2], "board": cards[2:], "category": made_hand(cards[:2], cards[2:])})
    # Rare categories, forced.
    for hole, board in [
        (["Ah", "Kh"], ["Qh", "Jh", "Th"]), (["5c", "4d"], ["3s", "2h", "Ad"]),
        (["9s", "9h"], ["9d", "9c", "2s"]), (["7s", "7h"], ["7d", "2c", "2s"]),
        (["2s", "3s"], ["4s", "5s", "As", "Kd", "Kh"]), (["Ac", "Ad"], ["Ah", "Kc", "Kd", "Ks", "2c"]),
        (["Tc", "Jd"], ["Qh", "Ks", "Ac"]), (["2c", "7c"], ["9c", "Jc", "Kc", "Ad", "Ah"]),
    ]:
        out.append({"hole": hole, "board": board, "category": made_hand(hole, board)})
    return out


def fly_cases(data: dict, runs: Path, plan: list[tuple[str, str, int]]) -> list[dict]:
    brains: dict[str, Brain] = {}
    names = list(LADDER)
    out = []
    for arm, snap, n_hands in plan:
        readout: Readout = load_snapshot(runs / arm / "snapshots" / f"{snap}.npz")
        brain = None
        if arm != "nobrain":
            if arm not in brains:
                brains[arm] = Brain(N_FEATURES, BrainConfig(wiring=arm), data=data, kernel="csr")
            brain = brains[arm]
        sample = np.linspace(0, readout.W.shape[0] - 1, DESC_SAMPLE).astype(int)
        for i in range(n_hands):
            seed = 50_000 + 1000 * len(out) + i
            deck = shuffled_deck(seed)
            fly = i % 2
            opp_name = names[(i // 2) % 4]
            rngs = [np.random.default_rng((seed, 0)), np.random.default_rng((seed, 1))]
            h = Hand(deck)
            r = brain.zeros(1) if brain is not None else None
            actions, decisions = [], []
            while not h.done:
                o = h.obs()
                if o.seat != fly:
                    a = int(LADDER[opp_name](o, rngs[o.seat]))
                else:
                    u = encode(o)
                    if brain is not None:
                        r = brain.run(r, u[None, :])
                        x = brain.readout(r)
                    else:
                        x = u[None, :]
                    p = readout.probs(readout.normalise(x), o.legal[None, :])[0]
                    a = int(rngs[o.seat].choice(N_ACTIONS, p=p))
                    decisions.append({
                        "index": len(actions),
                        "obs": obs_json(o),
                        "features": [f(v) for v in u],
                        "sample": [f(v) for v in x[0, sample]],
                        "sum": f(np.asarray(x[0], np.float64).sum()),
                        "probs": [f(v) for v in p],
                    })
                actions.append(a)
                h.act(a)
            out.append({
                "arm": arm, "snapshot": snap, "fly_seat": fly, "opponent": opp_name, "deck": deck[:12],
                "actions": actions, "payoffs": list(h.payoffs), "sample_index": sample.tolist(),
                "decisions": decisions,
            })
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, default=ROOT / "data")
    ap.add_argument("--runs", type=Path, default=ROOT / "runs")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)

    def dump(name: str, obj) -> None:
        path = OUT / name
        path.write_text(json.dumps(obj, separators=(",", ":")))
        print(f"{path.relative_to(ROOT)}: {path.stat().st_size / 1e3:.0f} KB")

    dump("rules.json", rules_cases(600))
    dump("hands.json", hand_cases(2000))

    def snaps(arm: str) -> list[str]:
        return sorted(p.stem for p in (args.runs / arm / "snapshots").glob("h*.npz"))

    real = snaps("real")
    plan = [
        ("real", real[1], 24),  # early (h0 is untrained: uniform probabilities)
        ("real", real[len(real) // 2], 24),
        ("real", real[-1], 32),
        ("shuffled", snaps("shuffled")[-1], 24),
        ("nobrain", snaps("nobrain")[-1], 24),
    ]
    (OUT / "readouts").mkdir(exist_ok=True)
    for arm, snap, _ in plan:
        (OUT / "readouts" / f"{arm}-{snap}.f32").write_bytes(
            snapshot_bytes(args.runs / arm / "snapshots" / f"{snap}.npz")[0])
    cases = fly_cases(load(args.data / "brain.npz"), args.runs, plan)
    print(f"fly decisions: {sum(len(c['decisions']) for c in cases)}")
    dump("fly.json", {"snapshots": sorted({f"{a}/{s}" for a, s, _ in plan}), "hands": cases})


if __name__ == "__main__":
    main()

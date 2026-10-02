"""Exhibition hands for the fair screen: the latest trained fly plays one hand at a time
against the ladder, and every decision is captured as a short movie of whole-brain activity.

Read-only with respect to training: it loads snapshots, never writes to a run.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

import numpy as np

from flypoker.agent import Readout
from flypoker.bots import LADDER
from flypoker.brain import Brain, BrainConfig
from flypoker.features import N_FEATURES, encode
from flypoker.poker import ACTIONS, BB, FOLD, Hand, shuffled_deck
from flypoker.train import TrainConfig, load_snapshot

RUNS = Path(__file__).resolve().parent.parent / "runs"
OPPONENT_ORDER = ("random", "station", "maniac", "equity")
ACTIVITY_K = 1000.0  # activity byte = 255 * log1p(K r) / log1p(K): 0.001 -> 25, 0.01 -> 89, 1 -> 255


def activity_bytes(r: np.ndarray) -> bytes:
    v = np.log1p(ACTIVITY_K * np.maximum(r, 0.0)) * (255.0 / np.log1p(ACTIVITY_K))
    return np.clip(v, 0, 255).astype(np.uint8).tobytes()


def latest_snapshot(run: Path) -> Path:
    return sorted((run / "snapshots").glob("h*.npz"))[-1]


@dataclass
class Frame:
    """One brain timestep during a decision: raw uint8 activity for every neuron."""

    step: int
    steps: int
    activity: bytes


class Exhibition:
    def __init__(self, arm: str = "real", seed: int = 0):
        self.run = RUNS / arm
        cfg = json.loads((self.run / "config.json").read_text())
        train = TrainConfig(**cfg["train"])
        self.brain = Brain(N_FEATURES, BrainConfig(wiring=train.arm, **train.brain))
        self.snapshot: Path | None = None
        self.readout: Readout | None = None
        self.rng = np.random.default_rng(seed)
        self.hand_no = 0
        self.refresh()

    def refresh(self) -> None:
        snap = latest_snapshot(self.run)
        if snap != self.snapshot:
            self.snapshot, self.readout = snap, load_snapshot(snap)

    @property
    def snapshot_hands(self) -> int:
        return int(self.snapshot.stem[1:])

    def hand(self) -> Iterator[dict | Frame]:
        """Play one hand, yielding display events (dicts) and brain frames, in order."""
        self.refresh()
        opp_name = OPPONENT_ORDER[self.hand_no % len(OPPONENT_ORDER)]
        self.hand_no += 1
        opponent = LADDER[opp_name]
        seed = int(self.rng.integers(2**62))
        h = Hand(shuffled_deck(seed))
        fly = int(self.rng.integers(0, 2))
        rngs = [np.random.default_rng((seed, 0)), np.random.default_rng((seed, 1))]
        r = self.brain.zeros(1)
        yield {
            "type": "hand",
            "opponent": opp_name,
            "fly_button": fly == 1,
            "fly_cards": _hole(h, fly),
            "snapshot_hands": self.snapshot_hands,
        }
        board_seen = 0
        while not h.done:
            board = _board(h)
            if len(board) > board_seen:
                yield {"type": "board", "cards": board}
                board_seen = len(board)
            seat = h.actor
            o = h.obs()
            if seat != fly:
                a = opponent(o, rngs[seat])
                h.act(a)
                yield {"type": "action", "who": "opponent", "action": ACTIONS[a], "pot": h.state.total_pot_amount}
                continue
            yield {"type": "thinking", "legal": o.legal.tolist(), "pot": o.pot, "to_call": o.to_call}
            trace: list[np.ndarray] = []
            r = self.brain.run(r, encode(o)[None, :], trace=trace)
            for i, state in enumerate(trace):
                yield Frame(i + 1, len(trace), activity_bytes(state[:, 0]))
            z = self.readout.normalise(self.brain.readout(r))
            p = self.readout.probs(z, o.legal[None, :])[0]
            a = int(rngs[seat].choice(len(p), p=p))
            h.act(a)
            yield {
                "type": "decision",
                "probs": dict(zip(ACTIONS, np.round(p, 4).tolist())),
                "action": ACTIONS[a],
                "pot": h.state.total_pot_amount,
            }
        board = _board(h)
        if len(board) > board_seen:
            yield {"type": "board", "cards": board}
        yield {
            "type": "result",
            "fly_bb": h.payoffs[fly] / BB,
            "opponent_cards": _hole(h, 1 - fly),
            "showdown": h.history[-1][2] != FOLD,
        }


def _hole(h: Hand, seat: int) -> list[str]:
    return h.deck[0:2] if seat == 0 else h.deck[2:4]


def _board(h: Hand) -> list[str]:
    return [f"{c[0].rank}{c[0].suit}" for c in h.state.board_cards]


def run_stats(max_points: int = 240) -> dict:
    """Hands played per arm, plus the real fly's training-log series for the live graph."""
    out = {}
    for arm in ("real", "shuffled", "nobrain"):
        log = RUNS / arm / "log.jsonl"
        if not log.exists():
            continue
        lines = log.read_text().splitlines()
        last = json.loads(lines[-1]) if lines else {"hands": 0, "hands_per_sec": 0}
        out[arm] = {"hands": last["hands"], "hands_per_sec": last.get("hands_per_sec", 0)}
        if arm == "real":
            step = max(1, len(lines) // max_points)
            rows = [json.loads(ln) for ln in lines]
            out["series"] = [
                {"hands": r["hands"], "bb100": r["bb100"], "entropy": r["entropy"]}
                for r in rows[::-1][::step][::-1]
            ]
    ev = RUNS / "real" / "eval.jsonl"
    out["eval"] = [json.loads(ln) for ln in ev.read_text().splitlines()] if ev.exists() else []
    return out

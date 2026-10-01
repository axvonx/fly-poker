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

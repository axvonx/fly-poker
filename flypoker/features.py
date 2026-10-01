"""What the fly is shown: what a beginner at the table would see, nothing computed for it.

No equity, no hand-strength percentages. Cards, chips, position, the opponent's last move,
and the name of the hand you currently hold ("one pair") — the thing a beginner reads off
the cards without doing maths.
"""

from __future__ import annotations

import numpy as np

from flypoker.poker import CARD_INDEX, HAND_CATEGORIES, N_ACTIONS, STACK, Obs, made_hand

_LAYOUT = (
    ("hole", 52),
    ("board", 52),
    ("street", 4),
    ("button", 1),
    ("chips", 5),
    ("made_hand", len(HAND_CATEGORIES)),
    ("suited", 1),
    ("opp_last", N_ACTIONS + 1),  # +1: opponent hasn't acted this street
    ("raises", 1),
)
N_FEATURES = sum(n for _, n in _LAYOUT)
_OFFSET = {}
_o = 0
for _name, _n in _LAYOUT:
    _OFFSET[_name] = _o
    _o += _n


def encode(o: Obs) -> np.ndarray:
    x = np.zeros(N_FEATURES, dtype=np.float32)
    for c in o.hole:
        x[_OFFSET["hole"] + CARD_INDEX[c]] = 1.0
    for c in o.board:
        x[_OFFSET["board"] + CARD_INDEX[c]] = 1.0
    x[_OFFSET["street"] + o.street] = 1.0
    x[_OFFSET["button"]] = float(o.is_button)
    pot_odds = o.to_call / (o.pot + o.to_call) if o.to_call else 0.0
    x[_OFFSET["chips"]: _OFFSET["chips"] + 5] = (
        o.pot / STACK,
        o.to_call / STACK,
        o.stack / STACK,
        o.opp_stack / STACK,
        pot_odds,
    )
    x[_OFFSET["made_hand"] + made_hand(o.hole, o.board)] = 1.0
    x[_OFFSET["suited"]] = float(o.hole[0][1] == o.hole[1][1])
    this_street = [a for seat, st, a in o.history if st == o.street]
    opp = [a for seat, st, a in o.history if st == o.street and seat != o.seat]
    x[_OFFSET["opp_last"] + (opp[-1] if opp else N_ACTIONS)] = 1.0
    x[_OFFSET["raises"]] = sum(a >= 2 for a in this_street) / 4.0
    return x

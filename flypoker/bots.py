"""The opponent ladder. Every bot is a function (obs, rng) -> action."""

from __future__ import annotations

import numpy as np
from pokerkit import StandardHighHand

from flypoker.poker import ALLIN, CALL, DECK, FOLD, HALF, POT, Obs


def random_bot(o: Obs, rng: np.random.Generator) -> int:
    return int(rng.choice(np.flatnonzero(o.legal)))


def calling_station(o: Obs, rng: np.random.Generator) -> int:
    return CALL


def maniac(o: Obs, rng: np.random.Generator) -> int:
    for a in (POT, ALLIN):
        if o.legal[a]:
            return a
    return CALL


def equity(o: Obs, rng: np.random.Generator, rollouts: int = 48) -> float:
    """Monte Carlo win probability against one uniformly random hand."""
    seen = set(o.hole) | set(o.board)
    rest = [c for c in DECK if c not in seen]
    hole = "".join(o.hole)
    need = 5 - len(o.board)
    score = 0.0
    for _ in range(rollouts):
        draw = rng.choice(len(rest), 2 + need, replace=False)
        opp = rest[draw[0]] + rest[draw[1]]
        board = "".join(o.board) + "".join(rest[i] for i in draw[2:])
        mine = StandardHighHand.from_game(hole, board)
        theirs = StandardHighHand.from_game(opp, board)
        score += 1.0 if mine > theirs else 0.5 if mine == theirs else 0.0
    return score / rollouts


def equity_bot(o: Obs, rng: np.random.Generator) -> int:
    """Tight-aggressive by equity vs a random hand, calling only with pot odds."""
    eq = equity(o, rng)
    pot_odds = o.to_call / (o.pot + o.to_call) if o.to_call else 0.0
    if eq > 0.85 and o.legal[ALLIN]:
        return ALLIN
    if eq > 0.70 and o.legal[POT]:
        return POT
    if eq > 0.60 and o.legal[HALF]:
        return HALF
    if o.to_call == 0 or eq >= pot_odds + 0.05:
        return CALL
    return FOLD


LADDER = {
    "random": random_bot,
    "station": calling_station,
    "maniac": maniac,
    "equity": equity_bot,
}

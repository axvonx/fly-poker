"""Heads-up no-limit hold'em in Slumbot's format, on top of pokerkit.

Seat 0 is the big blind, seat 1 the button / small blind (pokerkit's heads-up convention).
Cards come from our own seeded deck so a deal can be replayed exactly (duplicate eval).
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass, field

import numpy as np
from pokerkit import Automation, Mode, NoLimitTexasHoldem, StandardHighHand

warnings.filterwarnings("ignore", module="pokerkit")

SB, BB, STACK = 50, 100, 20_000
ACTIONS = ("fold", "call", "half", "pot", "allin")  # "call" is check-or-call
N_ACTIONS = len(ACTIONS)
FOLD, CALL, HALF, POT, ALLIN = range(N_ACTIONS)

RANKS = "23456789TJQKA"
SUITS = "cdhs"
DECK = [r + s for r in RANKS for s in SUITS]
CARD_INDEX = {c: i for i, c in enumerate(DECK)}

_AUTOMATIONS = (
    Automation.ANTE_POSTING,
    Automation.BET_COLLECTION,
    Automation.BLIND_OR_STRADDLE_POSTING,
    Automation.RUNOUT_COUNT_SELECTION,
    Automation.HOLE_CARDS_SHOWING_OR_MUCKING,
    Automation.HAND_KILLING,
    Automation.CHIPS_PUSHING,
    Automation.CHIPS_PULLING,
)
# board cards so far -> (deck slice to deal, burn card). Burns use deck cards never dealt.
_BOARD_DEALS = {0: ((4, 7), 9), 3: ((7, 8), 10), 4: ((8, 9), 11)}


def shuffled_deck(seed: int) -> list[str]:
    rng = np.random.default_rng(seed)
    return [DECK[i] for i in rng.permutation(52)]


def card_str(card) -> str:
    return f"{card.rank}{card.suit}"


@dataclass
class Obs:
    """What one seat can see when it is asked to act."""

    seat: int
    hole: list[str]
    board: list[str]
    street: int  # 0 preflop .. 3 river
    pot: int  # chips in the middle, including current-street bets
    to_call: int
    stack: int
    opp_stack: int
    history: list[tuple[int, int, int]]  # (seat, street, action)
    legal: np.ndarray  # bool[N_ACTIONS]

    @property
    def is_button(self) -> bool:
        return self.seat == 1


@dataclass
class Hand:
    deck: list[str]
    history: list[tuple[int, int, int]] = field(default_factory=list)

    def __post_init__(self) -> None:
        s = NoLimitTexasHoldem.create_state(
            _AUTOMATIONS, True, 0, (SB, BB), BB, STACK, 2, mode=Mode.CASH_GAME
        )
        s.deal_hole("".join(self.deck[0:2]))
        s.deal_hole("".join(self.deck[2:4]))
        self.state = s
        self._advance()

    # -- dealing -------------------------------------------------------------
    def _advance(self) -> None:
        s = self.state
        while s.status and (s.can_burn_card() or s.can_deal_board()):
            (lo, hi), burn = _BOARD_DEALS[len(s.board_cards)]
            if s.can_burn_card():
                s.burn_card(self.deck[burn])
            s.deal_board("".join(self.deck[lo:hi]))

    # -- queries -------------------------------------------------------------
    @property
    def done(self) -> bool:
        return not self.state.status

    @property
    def actor(self) -> int | None:
        return self.state.actor_index

    @property
    def payoffs(self) -> tuple[int, int]:
        p = self.state.payoffs
        return int(p[0]), int(p[1])

    @property
    def street(self) -> int:
        return {0: 0, 3: 1, 4: 2, 5: 3}[len(self.state.board_cards)]

    def _raise_to(self, frac: float) -> int:
        s = self.state
        me = s.actor_index
        to_call = s.checking_or_calling_amount
        pot_after_call = s.total_pot_amount + to_call
        target = max(s.bets) + int(frac * pot_after_call)
        lo = s.min_completion_betting_or_raising_to_amount
        hi = s.max_completion_betting_or_raising_to_amount
        assert lo is not None and hi is not None and me is not None
        return int(min(max(target, lo), hi))

    def legal_mask(self) -> np.ndarray:
        s = self.state
        m = np.zeros(N_ACTIONS, dtype=bool)
        if self.done:
            return m
        m[CALL] = s.can_check_or_call()
        m[FOLD] = s.can_fold() and s.checking_or_calling_amount > 0
        if s.can_complete_bet_or_raise_to():
            hi = s.max_completion_betting_or_raising_to_amount
            m[ALLIN] = True
            # Sized raises are only distinct from all-in when they land below it.
            m[HALF] = self._raise_to(0.5) < hi
            m[POT] = self._raise_to(1.0) < hi
        return m

    def obs(self) -> Obs:
        s = self.state
        seat = s.actor_index
        assert seat is not None
        return Obs(
            seat=seat,
            hole=[card_str(c) for c in s.hole_cards[seat]],
            board=[card_str(c[0]) for c in s.board_cards],
            street=self.street,
            pot=int(s.total_pot_amount),
            to_call=int(s.checking_or_calling_amount),
            stack=int(s.stacks[seat]),
            opp_stack=int(s.stacks[1 - seat]),
            history=list(self.history),
            legal=self.legal_mask(),
        )

    # -- acting --------------------------------------------------------------
    def act(self, action: int) -> None:
        if not self.legal_mask()[action]:
            raise ValueError(f"illegal action {ACTIONS[action]}")
        s = self.state
        seat, street = s.actor_index, self.street
        if action == FOLD:
            s.fold()
        elif action == CALL:
            s.check_or_call()
        elif action == ALLIN:
            s.complete_bet_or_raise_to(s.max_completion_betting_or_raising_to_amount)
        else:
            s.complete_bet_or_raise_to(self._raise_to(0.5 if action == HALF else 1.0))
        self.history.append((seat, street, action))
        self._advance()


HAND_CATEGORIES = (
    "High card",
    "One pair",
    "Two pair",
    "Three of a kind",
    "Straight",
    "Flush",
    "Full house",
    "Four of a kind",
    "Straight flush",
)
_CATEGORY_INDEX = {name: i for i, name in enumerate(HAND_CATEGORIES)}


def made_hand(hole: list[str], board: list[str]) -> int:
    """Index into HAND_CATEGORIES of the best hand a player can see right now."""
    if not board:
        return 1 if hole[0][0] == hole[1][0] else 0
    hand = StandardHighHand.from_game("".join(hole), "".join(board))
    return _CATEGORY_INDEX[str(hand.entry.label.value)]


def play(deck: list[str], players, rngs) -> tuple[int, int]:
    """Play one hand; players[seat](obs, rng) -> action. Returns chip payoffs per seat."""
    h = Hand(deck)
    while not h.done:
        seat = h.actor
        h.act(players[seat](h.obs(), rngs[seat]))
    return h.payoffs

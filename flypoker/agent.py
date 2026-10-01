"""The fly as a poker player, and the batched table loop shared by training and eval.

The only trained parameters are the readout: a softmax over the 5 actions from the
(normalised) descending-neuron rates. The `nobrain` arm uses the same readout directly
on the input features, as a control for whether the connectome contributes anything.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from flypoker.brain import Brain
from flypoker.features import encode
from flypoker.poker import BB, N_ACTIONS, Hand

Z_CLIP = 5.0  # normalised readout inputs are clipped: rare-firing neurons make heavy tails


@dataclass
class Readout:
    W: np.ndarray  # (D, A)
    b: np.ndarray  # (A,)
    mu: np.ndarray | None = None  # frozen input normaliser, set by calibrate()
    sd: np.ndarray | None = None

    @classmethod
    def zeros(cls, dim: int) -> Readout:
        return cls(np.zeros((dim, N_ACTIONS), np.float32), np.zeros(N_ACTIONS, np.float32))

    def normalise(self, x: np.ndarray) -> np.ndarray:
        if self.mu is None:
            return x
        return np.clip((x - self.mu) / self.sd, -Z_CLIP, Z_CLIP)

    def probs(self, z: np.ndarray, mask: np.ndarray) -> np.ndarray:
        logits = z @ self.W + self.b
        logits = np.where(mask, logits, -np.inf)
        logits -= logits.max(axis=1, keepdims=True)
        p = np.exp(logits)
        return p / p.sum(axis=1, keepdims=True)


@dataclass
class Fly:
    """A batch agent: the frozen brain (or None for the no-brain control) plus a readout."""

    brain: Brain | None
    readout: Readout
    greedy: bool = False
    record: bool = False
    _r: np.ndarray | None = field(default=None, repr=False)

    def begin(self, batch: int) -> None:
        self._r = self.brain.zeros(batch) if self.brain is not None else None

    def raw(self, idx: list[int], u: np.ndarray) -> np.ndarray:
        """Advance the brains of hands `idx` under inputs u; return un-normalised readout."""
        if self.brain is None:
            return u
        r = self.brain.run(self._r[:, idx], u)
        self._r[:, idx] = r
        return self.brain.readout(r)

    def act(self, idx, obs, rngs):
        u = np.stack([encode(o) for o in obs])
        mask = np.stack([o.legal for o in obs])
        z = self.readout.normalise(self.raw(idx, u))
        p = self.readout.probs(z, mask)
        if self.greedy:
            acts = p.argmax(axis=1)
        else:
            acts = np.array([r.choice(N_ACTIONS, p=pi) for r, pi in zip(rngs, p)])
        steps = [(z[k], mask[k], int(acts[k])) for k in range(len(idx))] if self.record else None
        return acts, steps


@dataclass
class BotAgent:
    """Wraps a ladder bot in the batch-agent interface (used by tests and baselines)."""

    bot: object

    def begin(self, batch: int) -> None:
        pass

    def act(self, idx, obs, rngs):
        return np.array([self.bot(o, r) for o, r in zip(obs, rngs)]), None


def play_batch(agent, decks, agent_seats, opponents, seeds):
    """Play len(decks) hands in lockstep. Each hand's seats draw from their own RNG,
    seeded by (seed, seat), so a deal replayed with seats swapped is a true duplicate.

    Returns (agent payoffs in big blinds, per-hand list of recorded agent decisions).
    """
    n = len(decks)
    hands = [Hand(d) for d in decks]
    rngs = [[np.random.default_rng((s, 0)), np.random.default_rng((s, 1))] for s in seeds]
    traj = [[] for _ in range(n)]
    agent.begin(n)
    while True:
        pending = []
        for i, h in enumerate(hands):
            while not h.done and h.actor != agent_seats[i]:
                h.act(opponents[i](h.obs(), rngs[i][h.actor]))
            if not h.done:
                pending.append(i)
        if not pending:
            break
        obs = [hands[i].obs() for i in pending]
        acts, steps = agent.act(pending, obs, [rngs[i][agent_seats[i]] for i in pending])
        for k, i in enumerate(pending):
            hands[i].act(int(acts[k]))
            if steps is not None:
                traj[i].append(steps[k])
    payoff = np.array([h.payoffs[s] / BB for h, s in zip(hands, agent_seats)], np.float32)
    return payoff, traj

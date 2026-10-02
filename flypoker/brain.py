"""The frozen connectome as a rate-based reservoir.

    r <- (1 - alpha) r + alpha * relu(gain * W r + E u)

W is the signed MaleCNS connectome with each neuron's inputs normalised to unit total
weight (so gain < 1 keeps the dynamics contracting). E routes each input feature to a
fixed, seeded group of sensory neurons. Nothing here is ever trained.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import numpy as np
import scipy.sparse as sp

from flypoker.data import load


@dataclass(frozen=True)
class BrainConfig:
    wiring: str = "real"  # "real" | "shuffled"
    shuffle_seed: int = 0
    input_seed: int = 0
    gain: float = 0.95
    alpha: float = 0.5
    input_gain: float = 1.0
    steps: int = 8  # dynamics steps per decision


def _normalised(pre, post, weight, n) -> sp.csr_matrix:
    w = sp.csr_matrix((weight, (post, pre)), shape=(n, n), dtype=np.float32)
    w.sum_duplicates()
    total = np.asarray(abs(w).sum(axis=1)).ravel()
    total[total == 0] = 1.0
    return (sp.diags((1.0 / total).astype(np.float32)) @ w).tocsr()


def shuffle_targets(pre, post, seed: int) -> np.ndarray:
    """Rewire: permute postsynaptic targets across all edges.

    Every neuron keeps its out-degree, out-weights and transmitter sign, and its
    in-degree (edge count); only *who connects to whom* is destroyed.
    """
    return post[np.random.default_rng(seed).permutation(len(post))]


KERNELS = ("csr", "skip", "mps")


class Brain:
    """`threads` and `kernel` are operational: they change speed, never the model.

    - threads: the connectome multiply is split into row blocks (bit-identical).
    - kernel="skip": exactly-silent neurons' columns are skipped. Same sum, different
      addition order, so results differ at float32 rounding (<= ~3e-8 relative).
    - kernel="mps": the dynamics run on the Apple GPU (torch, Metal). Rounding-level
      differences (~2e-7 relative), 10-18x faster multiplies at training batch sizes.
    """

    def __init__(self, n_features: int, config: BrainConfig = BrainConfig(), data=None, threads: int = 1,
                 kernel: str = "csr"):
        d = data if data is not None else load()
        self.config = config
        self.data_config = d["config"]
        n = len(d["ids"])
        post = d["post"]
        if config.wiring == "shuffled":
            post = shuffle_targets(d["pre"], post, config.shuffle_seed)
        elif config.wiring != "real":
            raise ValueError(config.wiring)
        self.W = _normalised(d["pre"], post, d["weight"], n)
        self.n = n
        self.set_threads(threads)
        if kernel not in KERNELS:
            raise ValueError(kernel)
        self.kernel = kernel
        self._Wc = self.W.tocsc() if kernel == "skip" else None
        self._gpu = _GpuDynamics(self.W) if kernel == "mps" else None
        self.sensory = d["sensory"]
        self.descending = d["descending"]
        self.superclass = d["superclass"]

        # Each sensory neuron listens to exactly one feature.
        rng = np.random.default_rng(config.input_seed)
        groups = rng.permutation(len(self.sensory)) % n_features
        self.E = sp.csr_matrix(
            (np.full(len(self.sensory), config.input_gain, np.float32), (self.sensory, groups)),
            shape=(n, n_features),
        )
        self.n_features = n_features

    def set_threads(self, threads: int) -> None:
        self.threads = max(1, threads)
        bounds = np.linspace(0, self.n, self.threads + 1).astype(int)
        self._rows = list(zip(bounds[:-1], bounds[1:]))
        self._blocks = [self.W[lo:hi] for lo, hi in self._rows]
        self._pool = ThreadPoolExecutor(self.threads) if self.threads > 1 else None

    def _connectome(self, r: np.ndarray) -> np.ndarray:
        if self._Wc is not None:
            active = np.flatnonzero(r.any(axis=1))
            if len(active) < 0.85 * self.n:  # past that, skipping costs more than it saves
                if not len(active):
                    return np.zeros_like(r)
                return np.asarray(self._Wc[:, active] @ r[active])
        if self._pool is None:
            return self.W @ r
        out = np.empty((self.n, r.shape[1]), np.float32)

        def block(i: int) -> None:
            lo, hi = self._rows[i]
            out[lo:hi] = self._blocks[i] @ r

        list(self._pool.map(block, range(self.threads)))
        return out

    @property
    def n_readout(self) -> int:
        return len(self.descending)

    def zeros(self, batch: int) -> np.ndarray:
        return np.zeros((self.n, batch), dtype=np.float32)

    def run(self, r: np.ndarray, u: np.ndarray, trace: list | None = None) -> np.ndarray:
        """Advance states r (n, B) for config.steps steps under inputs u (B, F).

        If `trace` is given, the state after every step is appended to it (for display).
        """
        c = self.config
        drive = np.asarray(self.E @ u.T.astype(np.float32))
        if self._gpu is not None:
            return self._gpu.run(r, drive, c, trace)
        for _ in range(c.steps):
            x = c.gain * self._connectome(r) + drive
            np.maximum(x, 0.0, out=x)
            r = (1.0 - c.alpha) * r + c.alpha * x
            if trace is not None:
                trace.append(r)
        return r

    def readout(self, r: np.ndarray) -> np.ndarray:
        """Descending-neuron rates, shape (B, n_readout)."""
        return r[self.descending].T


class _GpuDynamics:
    """The same dynamics on the Apple GPU. torch's Metal backend supports sparse COO."""

    def __init__(self, W: sp.csr_matrix):
        import torch

        self.torch = torch
        self.device = torch.device("mps")
        coo = W.tocoo()
        idx = torch.from_numpy(np.vstack([coo.row, coo.col]).astype(np.int64))
        self.W = torch.sparse_coo_tensor(idx, torch.from_numpy(coo.data), size=W.shape).coalesce().to(self.device)

    def run(self, r: np.ndarray, drive: np.ndarray, c: BrainConfig, trace: list | None) -> np.ndarray:
        t = self.torch
        rt = t.from_numpy(np.ascontiguousarray(r)).to(self.device)
        dt = t.from_numpy(np.ascontiguousarray(drive)).to(self.device)
        for _ in range(c.steps):
            x = (self.W @ rt).mul_(c.gain).add_(dt).clamp_(min=0.0)
            rt = rt.mul(1.0 - c.alpha).add_(x, alpha=c.alpha)
            if trace is not None:
                trace.append(rt.cpu().numpy())
        return rt.cpu().numpy()

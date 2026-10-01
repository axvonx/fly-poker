"""Train the fly's readout by REINFORCE, resumably, forever (or until --hands).

    uv run python -m flypoker.train runs/real --wiring real
    uv run python -m flypoker.train runs/real            # resume with the saved config

Layout of a run directory:
    config.json            frozen at creation; resume refuses a different one
    log.jsonl              one line per checkpoint interval; x-axis is hands played
    ckpt/latest.npz        full training state (atomic write)
    snapshots/h*.npz       readout only, every --snapshot-every hands, for eval replay
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import os
import subprocess
import time
from collections import defaultdict
from pathlib import Path

import numpy as np

from flypoker.agent import Fly, Readout, play_batch
from flypoker.bots import LADDER
from flypoker.brain import Brain, BrainConfig
from flypoker.data import load
from flypoker.features import N_FEATURES
from flypoker.poker import ACTIONS, N_ACTIONS, shuffled_deck

TRAIN_OPPONENTS = ("random", "station", "maniac", "equity")
CALIBRATION_HANDS = 256


@dataclasses.dataclass
class TrainConfig:
    arm: str = "real"  # real | shuffled | nobrain
    seed: int = 0
    tables: int = 16  # hands played in lockstep per batch
    lr: float = 3e-4
    entropy: float = 0.01
    reward_scale: float = 20.0  # big blinds per unit of advantage
    reward_clip: float = 5.0
    baseline_decay: float = 0.01
    checkpoint_every: int = 2_000
    snapshot_every: int = 10_000
    max_hands_per_sec: float = 0.0  # 0 = unthrottled
    brain: dict = dataclasses.field(default_factory=dict)


def make_fly(cfg: TrainConfig, data=None) -> Fly:
    if cfg.arm == "nobrain":
        return Fly(None, Readout.zeros(N_FEATURES))
    bc = BrainConfig(wiring=cfg.arm, **cfg.brain)
    brain = Brain(N_FEATURES, bc, data=data if data is not None else load())
    return Fly(brain, Readout.zeros(brain.n_readout))


def calibrate(fly: Fly, seed: int) -> None:
    """Freeze the readout's input normaliser from an untrained (uniform) fly's activity."""
    rng = np.random.default_rng((seed, 99))
    fly.record = True
    zs = []
    for lo in range(0, CALIBRATION_HANDS, 32):
        decks = [shuffled_deck(int(s)) for s in rng.integers(2**62, size=32)]
        opps = [LADDER[TRAIN_OPPONENTS[i % 4]] for i in range(32)]
        seats = list(rng.integers(0, 2, size=32))
        _, traj = play_batch(fly, decks, seats, opps, rng.integers(2**62, size=32))
        zs += [z for t in traj for z, _, _ in t]
    x = np.stack(zs)
    fly.readout.mu = x.mean(axis=0).astype(np.float32)
    sd = x.std(axis=0)
    fly.readout.sd = np.where(sd > 1e-6, sd, 1.0).astype(np.float32)


class Adam:
    def __init__(self, shapes, lr, b1=0.9, b2=0.999, eps=1e-8):
        self.lr, self.b1, self.b2, self.eps, self.t = lr, b1, b2, eps, 0
        self.m = [np.zeros(s, np.float32) for s in shapes]
        self.v = [np.zeros(s, np.float32) for s in shapes]

    def ascend(self, params, grads):
        self.t += 1
        for p, g, m, v in zip(params, grads, self.m, self.v):
            m *= self.b1
            m += (1 - self.b1) * g
            v *= self.b2
            v += (1 - self.b2) * g * g
            mh = m / (1 - self.b1**self.t)
            vh = v / (1 - self.b2**self.t)
            p += self.lr * mh / (np.sqrt(vh) + self.eps)


def policy_gradient(readout: Readout, traj, adv, entropy_coef):
    z = np.stack([s[0] for t in traj for s in t])
    mask = np.stack([s[1] for t in traj for s in t])
    act = np.array([s[2] for t in traj for s in t])
    a = np.concatenate([np.full(len(t), adv[i], np.float32) for i, t in enumerate(traj)])
    p = readout.probs(z, mask)
    logp = np.log(np.where(mask, p, 1.0))
    h = -(p * logp).sum(axis=1)
    g = -p * a[:, None]
    g[np.arange(len(act)), act] += a
    g += entropy_coef * (-p * (logp + h[:, None]))
    n = len(act)
    return [z.T @ g / n, g.sum(axis=0) / n], float(h.mean()), np.bincount(act, minlength=N_ACTIONS)


def _git_commit() -> str:
    try:
        return subprocess.run(
            ["git", "rev-parse", "HEAD"], capture_output=True, text=True,
            cwd=Path(__file__).parent, check=True,
        ).stdout.strip()
    except subprocess.CalledProcessError:
        return "uncommitted"


def _atomic_savez(path: Path, **arrays) -> None:
    tmp = path.with_suffix(".tmp.npz")
    np.savez(tmp, **arrays)
    os.replace(tmp, path)


def save(run: Path, readout: Readout, opt: Adam, baseline, hands: int, rng) -> None:
    _atomic_savez(
        run / "ckpt" / "latest.npz",
        W=readout.W, b=readout.b, mu=readout.mu, sd=readout.sd,
        m0=opt.m[0], m1=opt.m[1], v0=opt.v[0], v1=opt.v[1], t=opt.t,
        baseline=json.dumps(baseline), hands=hands,
        rng=json.dumps(rng.bit_generator.state),
    )


def load_snapshot(path: Path) -> Readout:
    z = np.load(path)
    return Readout(z["W"], z["b"], z["mu"], z["sd"])


def train(run: Path, cfg: TrainConfig, max_hands: int | None = None) -> None:
    (run / "ckpt").mkdir(parents=True, exist_ok=True)
    (run / "snapshots").mkdir(exist_ok=True)
    fly = make_fly(cfg)
    opt = Adam([fly.readout.W.shape, fly.readout.b.shape], cfg.lr)
    latest = run / "ckpt" / "latest.npz"
    log = run / "log.jsonl"

    if latest.exists():
        z = np.load(latest)
        fly.readout = Readout(z["W"], z["b"], z["mu"], z["sd"])
        opt.m, opt.v, opt.t = [z["m0"], z["m1"]], [z["v0"], z["v1"]], int(z["t"])
        baseline = json.loads(str(z["baseline"]))
        hands = int(z["hands"])
        rng = np.random.default_rng()
        rng.bit_generator.state = json.loads(str(z["rng"]))
        # Drop log lines written after the checkpoint we resumed from.
        if log.exists():
            lines = [ln for ln in log.read_text().splitlines() if json.loads(ln)["hands"] <= hands]
            log.write_text("".join(ln + "\n" for ln in lines))
        print(f"resumed at {hands} hands", flush=True)
    else:
        calibrate(fly, cfg.seed)
        baseline = {o: 0.0 for o in TRAIN_OPPONENTS}
        hands = 0
        rng = np.random.default_rng(cfg.seed)
        save(run, fly.readout, opt, baseline, hands, rng)
        _atomic_savez(run / "snapshots" / "h000000000.npz", W=fly.readout.W, b=fly.readout.b,
                      mu=fly.readout.mu, sd=fly.readout.sd)

    fly.record = True
    acc = defaultdict(list)
    acts = np.zeros(N_ACTIONS, np.int64)
    ents = []
    t_interval = time.time()
    while max_hands is None or hands < max_hands:
        t_batch = time.time()
        n = cfg.tables
        opp_names = [TRAIN_OPPONENTS[i] for i in rng.integers(0, len(TRAIN_OPPONENTS), n)]
        decks = [shuffled_deck(int(s)) for s in rng.integers(2**62, size=n)]
        seats = [int(s) for s in rng.integers(0, 2, n)]
        payoff, traj = play_batch(
            fly, decks, seats, [LADDER[o] for o in opp_names], rng.integers(2**62, size=n)
        )
        adv = np.array([payoff[i] - baseline[o] for i, o in enumerate(opp_names)], np.float32)
        adv = np.clip(adv / cfg.reward_scale, -cfg.reward_clip, cfg.reward_clip)
        if any(traj):
            grads, h, counts = policy_gradient(fly.readout, traj, adv, cfg.entropy)
            opt.ascend([fly.readout.W, fly.readout.b], grads)
            ents.append(h)
            acts += counts
        for i, o in enumerate(opp_names):
            baseline[o] += cfg.baseline_decay * (float(payoff[i]) - baseline[o])
            acc[o].append(float(payoff[i]))
        hands += n

        if hands % cfg.checkpoint_every < n:
            now = time.time()
            entry = {
                "hands": hands,
                "time": now,
                "hands_per_sec": sum(len(v) for v in acc.values()) / (now - t_interval),
                "bb100": {o: float(np.mean(v) * 100) for o, v in acc.items()},
                "entropy": float(np.mean(ents)) if ents else None,
                "actions": dict(zip(ACTIONS, (acts / max(acts.sum(), 1)).round(4).tolist())),
                "w_norm": float(np.linalg.norm(fly.readout.W)),
            }
            with log.open("a") as f:
                f.write(json.dumps(entry) + "\n")
            if hands % cfg.snapshot_every < n:
                _atomic_savez(run / "snapshots" / f"h{hands:09d}.npz", W=fly.readout.W,
                              b=fly.readout.b, mu=fly.readout.mu, sd=fly.readout.sd)
            save(run, fly.readout, opt, baseline, hands, rng)
            acc.clear()
            acts[:] = 0
            ents.clear()
            t_interval = now

        if cfg.max_hands_per_sec:
            wait = n / cfg.max_hands_per_sec - (time.time() - t_batch)
            if wait > 0:
                time.sleep(wait)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("run", type=Path)
    ap.add_argument("--arm", choices=("real", "shuffled", "nobrain"))
    ap.add_argument("--hands", type=int, default=None, help="stop after this many total hands")
    ap.add_argument("--set", action="append", default=[], metavar="KEY=JSON",
                    help="override a TrainConfig field, e.g. --set lr=1e-3 --set brain='{\"gain\":0.8}'")
    args = ap.parse_args()

    cfg_path = args.run / "config.json"
    if cfg_path.exists():
        saved = json.loads(cfg_path.read_text())
        if args.arm or args.set:
            raise SystemExit("run already exists; its config is frozen (omit --arm/--set to resume)")
        cfg = TrainConfig(**saved["train"])
    else:
        cfg = TrainConfig(arm=args.arm or "real")
        for kv in args.set:
            k, v = kv.split("=", 1)
            setattr(cfg, k, json.loads(v))
        args.run.mkdir(parents=True, exist_ok=True)
        meta = {
            "train": dataclasses.asdict(cfg),
            "brain_config": None if cfg.arm == "nobrain"
            else dataclasses.asdict(BrainConfig(wiring=cfg.arm, **cfg.brain)),
            "data": None if cfg.arm == "nobrain" else load()["config"],
            "git_commit": _git_commit(),
            "created": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        }
        cfg_path.write_text(json.dumps(meta, indent=2))
    train(args.run, cfg, args.hands)


if __name__ == "__main__":
    main()

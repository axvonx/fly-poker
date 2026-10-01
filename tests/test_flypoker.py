import json
import signal
import subprocess
import sys
import time

import numpy as np
import pytest

from flypoker.agent import BotAgent, play_batch
from flypoker.bots import LADDER
from flypoker.brain import shuffle_targets
from flypoker.data import BRAIN
from flypoker.evaluate import duplicate
from flypoker.poker import STACK, Hand, shuffled_deck


def test_chips_conserved_and_bounded():
    for k in range(300):
        rng = np.random.default_rng(k)
        h = Hand(shuffled_deck(k))
        while not h.done:
            h.act(LADDER["random"](h.obs(), rng))
        p0, p1 = h.payoffs
        assert p0 + p1 == 0 and abs(p0) <= STACK


@pytest.mark.parametrize("name", ["random", "station", "maniac"])
def test_duplicate_self_play_is_exactly_zero(name):
    r = duplicate(BotAgent(LADDER[name]), LADDER[name], pairs=64)
    assert r["bb100"] == 0.0


def test_equity_bot_beats_random():
    r = duplicate(BotAgent(LADDER["equity"]), LADDER["random"], pairs=96)
    assert r["bb100"] - r["ci95"] > 0


def test_seat_rngs_make_replays_identical():
    decks = [shuffled_deck(k) for k in range(8)]
    a, _ = play_batch(BotAgent(LADDER["random"]), decks, [0] * 8, [LADDER["random"]] * 8, range(8))
    b, _ = play_batch(BotAgent(LADDER["random"]), decks, [0] * 8, [LADDER["random"]] * 8, range(8))
    assert np.array_equal(a, b)


def test_shuffle_preserves_degrees():
    rng = np.random.default_rng(0)
    pre = rng.integers(0, 50, 1000)
    post = rng.integers(0, 50, 1000)
    new = shuffle_targets(pre, post, seed=3)
    assert np.array_equal(np.bincount(post, minlength=50), np.bincount(new, minlength=50))
    assert not np.array_equal(post, new)  # pre (out-degree, sign, weight) untouched by design


@pytest.mark.skipif(not BRAIN.exists(), reason="run `python -m flypoker.data` first")
def test_reservoir_is_deterministic():
    from flypoker.brain import Brain, BrainConfig
    from flypoker.data import load

    d = load()
    u = np.random.default_rng(0).random((2, 10)).astype(np.float32)
    outs = [Brain(10, BrainConfig(), data=d) for _ in range(2)]
    r = [b.readout(b.run(b.zeros(2), u)) for b in outs]
    assert np.array_equal(r[0], r[1]) and r[0].std() > 0


def _log_hands(run):
    return [json.loads(ln)["hands"] for ln in (run / "log.jsonl").read_text().splitlines()]


def test_kill_and_resume(tmp_path):
    run = tmp_path / "run"
    base = [sys.executable, "-m", "flypoker.train", str(run)]
    p = subprocess.Popen(base + ["--arm", "nobrain", "--set", "checkpoint_every=32",
                                 "--set", "snapshot_every=64"])
    deadline = time.time() + 120
    while time.time() < deadline:
        if (run / "log.jsonl").exists() and len(_log_hands(run)) >= 3:
            break
        time.sleep(0.2)
    p.send_signal(signal.SIGKILL)
    p.wait()
    before = _log_hands(run)
    assert len(before) >= 3

    subprocess.run(base + ["--hands", str(before[-1] + 96)], check=True, timeout=120)
    after = _log_hands(run)
    assert after == sorted(set(after)), "log must be strictly increasing in hands"
    assert after[-1] >= before[-1] + 96
    assert (run / "snapshots" / "h000000000.npz").exists()

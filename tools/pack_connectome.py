"""Pack the frozen connectome for the browser: data/brain.npz -> web/public/data/connectome-<wiring>.bin

    uv run python tools/pack_connectome.py [--data DIR] [--out DIR]

The file is gzip-compressed. Inside, little-endian:

    header   u32 x 9: magic "FLYC", version, n, nnz, n_sensory, n_descending, n_features,
                      input_seed, varint_bytes
    rowptr   i32 x (n+1)    CSR over postsynaptic rows, exactly what `_normalised` sees
    sensory  i32 x n_sensory
    desc     i32 x n_descending
    weights  i16 x nnz      signed synapse counts (whole numbers in brain.npz)
    groups   u8  x n_sensory   input feature each sensory neuron listens to (Brain.E)
    cols     LEB128 varints: per row, the first column absolute, then deltas

The browser rebuilds the normalised matrix from the counts (see web/src/engine/connectome.ts).
This script checks that doing so in float32 reproduces Brain.W bit for bit.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import struct
import sys
from pathlib import Path

import numpy as np
import scipy.sparse as sp

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from flypoker.brain import Brain, BrainConfig  # noqa: E402
from flypoker.data import load  # noqa: E402
from flypoker.features import N_FEATURES  # noqa: E402

MAGIC = b"FLYC"
VERSION = 1


def varints(a: np.ndarray) -> bytes:
    """LEB128-encode non-negative ints (< 2^28), vectorised."""
    a = a.astype(np.uint32)
    nbytes = 1 + (a >= 1 << 7) + (a >= 1 << 14) + (a >= 1 << 21)
    assert (a < 1 << 28).all()
    out = np.zeros(int(nbytes.sum()), np.uint8)
    pos = np.concatenate([[0], np.cumsum(nbytes)[:-1]])
    for k in range(4):
        has = nbytes > k
        byte = (a[has] >> (7 * k)) & 0x7F
        more = nbytes[has] > k + 1
        out[pos[has] + k] = byte | (more.astype(np.uint32) << 7)
    return out.tobytes()


def pack(d: dict, wiring: str) -> tuple[bytes, dict]:
    config = BrainConfig(wiring=wiring)
    brain = Brain(N_FEATURES, config, data=d)  # the reference: what training runs on
    n = brain.n

    # Raw signed counts on the same (post, pre) layout Brain built, before normalisation.
    post = d["post"]
    if wiring == "shuffled":
        from flypoker.brain import shuffle_targets
        post = shuffle_targets(d["pre"], post, config.shuffle_seed)
    w = sp.csr_matrix((d["weight"], (post, d["pre"])), shape=(n, n), dtype=np.float32)
    w.sum_duplicates()
    assert np.array_equal(w.data, np.round(w.data)), "weights are not whole numbers"
    assert np.abs(w.data).max() <= 32767, "a summed count overflows int16"
    ref = brain.W.copy()
    ref.sort_indices()  # the diag product leaves rows unsorted; same entries
    assert np.array_equal(w.indptr, ref.indptr) and np.array_equal(w.indices, ref.indices)

    # The browser's normalisation, in float32, must match Brain.W exactly.
    rows = np.repeat(np.arange(n), np.diff(w.indptr))
    total = np.bincount(rows, weights=np.abs(w.data), minlength=n)  # whole numbers: exact
    total[total == 0] = 1.0
    scale = (1.0 / total).astype(np.float32)
    assert np.array_equal(w.data * scale[rows], ref.data), "normalisation does not round-trip"

    groups = np.zeros(len(brain.sensory), np.uint8)
    E = brain.E.tocsr()
    for k, s in enumerate(brain.sensory):
        lo, hi = E.indptr[s], E.indptr[s + 1]
        assert hi - lo == 1
        groups[k] = E.indices[lo]
    assert N_FEATURES < 256

    ip, ix = w.indptr.astype(np.int64), w.indices.astype(np.int64)
    delta = ix.copy()
    delta[1:] -= ix[:-1]
    starts = ip[:-1][np.diff(ip) > 0]
    delta[starts] = ix[starts]
    assert (delta >= 0).all()
    cols = varints(delta)

    header = MAGIC + struct.pack(
        "<8I", VERSION, n, w.nnz, len(brain.sensory), len(brain.descending), N_FEATURES,
        config.input_seed, len(cols),
    )
    body = b"".join([
        header,
        w.indptr.astype("<i4").tobytes(),
        brain.sensory.astype("<i4").tobytes(),
        brain.descending.astype("<i4").tobytes(),
        w.data.astype("<i2").tobytes(),
        groups.tobytes(),
        cols,
    ])
    meta = {
        "wiring": wiring,
        "version": VERSION,
        "n": n,
        "nnz": int(w.nnz),
        "n_sensory": len(brain.sensory),
        "n_descending": len(brain.descending),
        "n_features": N_FEATURES,
        "brain_config": {k: getattr(config, k) for k in config.__dataclass_fields__},
        "edges_sha256": d["config"]["edges_sha256"],
        "raw_bytes": len(body),
    }
    return body, meta


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, default=ROOT / "data")
    ap.add_argument("--out", type=Path, default=ROOT / "web" / "public" / "data")
    ap.add_argument("--wiring", nargs="+", default=["real", "shuffled"])
    args = ap.parse_args()
    brain_npz = args.data / "brain.npz"
    d = load(brain_npz)
    npz_sha = hashlib.sha256(brain_npz.read_bytes()).hexdigest()
    args.out.mkdir(parents=True, exist_ok=True)
    for wiring in args.wiring:
        body, meta = pack(d, wiring)
        blob = gzip.compress(body, compresslevel=9, mtime=0)
        path = args.out / f"connectome-{wiring}.bin"
        path.write_bytes(blob)
        meta.update(brain_npz_sha256=npz_sha, file_bytes=len(blob), file_sha256=hashlib.sha256(blob).hexdigest())
        (args.out / f"connectome-{wiring}.json").write_text(json.dumps(meta, indent=2) + "\n")
        print(f"{path}: {len(body) / 1e6:.1f} MB raw, {len(blob) / 1e6:.1f} MB gzipped")


if __name__ == "__main__":
    main()

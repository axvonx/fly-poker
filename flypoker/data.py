"""Build the frozen MaleCNS v1.0 connectome into a compact signed edge list.

Run once:  uv run python -m flypoker.data
Reads the public flat-connectome feathers in data/ and writes data/brain.npz.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.feather as pf

DATA = Path(__file__).resolve().parent.parent / "data"
BRAIN = DATA / "brain.npz"
_PREFIX = "male-cns-v1.0"
ANNOTATIONS = DATA / f"body-annotations-{_PREFIX}-minconf-0.5.feather"
NEUROTRANSMITTERS = DATA / f"body-neurotransmitters-{_PREFIX}.feather"
WEIGHTS = DATA / f"connectome-weights-{_PREFIX}-minconf-0.5.feather"

MIN_SYNAPSES = 5  # FlyWire-style threshold; drops ~75% of edges, few synapses

# Sign of a presynaptic neuron's output. Glutamate is inhibitory in most of the fly CNS
# (GluCl), as is histamine; monoamines are modulatory and left out of fast dynamics.
NT_SIGN = {
    "acetylcholine": 1.0,
    "gaba": -1.0,
    "glutamate": -1.0,
    "histamine": -1.0,
    "dopamine": 0.0,
    "octopamine": 0.0,
    "serotonin": 0.0,
}

SENSORY = ("ol_sensory", "cb_sensory", "vnc_sensory", "sensory_ascending", "sensory_descending")
DESCENDING = ("descending_neuron", "descending_neuron_tbc")


def _nt_sign(nt: pd.DataFrame, ids: np.ndarray) -> tuple[np.ndarray, pd.Series]:
    nt = nt.set_index("body")
    label = nt["consensus_nt"].where(nt["consensus_nt"] != "unclear", nt["predicted_nt"])
    label = label.reindex(ids)
    return label.map(NT_SIGN).fillna(0.0).to_numpy(np.float32), label


def build() -> tuple[dict, dict]:
    ann = pd.read_feather(ANNOTATIONS)
    ann = ann[ann.superclass.notna()].sort_values("bodyId").reset_index(drop=True)
    ids = ann.bodyId.to_numpy(np.int64)
    superclass = ann.superclass.to_numpy(str)

    sign, label = _nt_sign(pd.read_feather(NEUROTRANSMITTERS), ids)

    w = pf.read_table(WEIGHTS).to_pandas()
    w = w[w.weight >= MIN_SYNAPSES]
    pre = np.searchsorted(ids, w.body_pre.to_numpy())
    post = np.searchsorted(ids, w.body_post.to_numpy())
    keep = (
        (pre < len(ids)) & (post < len(ids))
        & (ids[np.minimum(pre, len(ids) - 1)] == w.body_pre.to_numpy())
        & (ids[np.minimum(post, len(ids) - 1)] == w.body_post.to_numpy())
    )
    pre, post = pre[keep], post[keep]
    count = w.weight.to_numpy()[keep].astype(np.float32)
    signed = count * sign[pre]
    nz = signed != 0
    pre, post, signed = pre[nz], post[nz], signed[nz]

    sensory = np.flatnonzero(np.isin(superclass, SENSORY))
    descending = np.flatnonzero(np.isin(superclass, DESCENDING))

    config = {
        "dataset": "MaleCNS v1.0 flat-connectome (minconf 0.5)",
        "min_synapses": MIN_SYNAPSES,
        "nt_sign": NT_SIGN,
        "sensory": SENSORY,
        "descending": DESCENDING,
    }
    out = {
        "ids": ids,
        "superclass": superclass,
        "pre": pre.astype(np.int32),
        "post": post.astype(np.int32),
        "weight": signed.astype(np.float32),
        "sensory": sensory.astype(np.int32),
        "descending": descending.astype(np.int32),
    }
    digest = hashlib.sha256()
    for k in ("pre", "post", "weight"):
        digest.update(out[k].tobytes())
    config["edges_sha256"] = digest.hexdigest()
    out["config"] = np.array(json.dumps(config))

    stats = {
        "neurons": len(ids),
        "edges": len(pre),
        "excitatory_edges": int((signed > 0).sum()),
        "inhibitory_edges": int((signed < 0).sum()),
        "sensory": len(sensory),
        "descending": len(descending),
        "nt_unlabelled_neurons": int(label.isna().sum()),
        "edges_sha256": config["edges_sha256"][:16],
    }
    return out, stats


def load(path: Path = BRAIN) -> dict:
    z = np.load(path, allow_pickle=False)
    d = {k: z[k] for k in z.files}
    d["config"] = json.loads(str(d["config"]))
    return d


if __name__ == "__main__":
    out, stats = build()
    np.savez_compressed(BRAIN, **out)
    print(json.dumps(stats, indent=2))

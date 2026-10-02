"""Neuron positions and coarse regions for the fair display.

Run once after flypoker.data:  uv run python -m flypoker.positions
Writes data/positions.npz: xyz (float32, microns, brain index order) and region (uint8).

84% of neurons have a soma location. Sensory neurons don't (their cell bodies sit outside
the CNS), so each unplaced neuron is put at the mean position of its placed partners.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import scipy.sparse as sp

from flypoker.data import ANNOTATIONS, DATA, load

POSITIONS = DATA / "positions.npz"
VOXEL_UM = 0.008  # somaLocation is in 8 nm voxels

REGIONS = ("sensory", "optic", "central", "nerve cord", "descending", "ascending", "motor")


def region_of(superclass: str) -> int:
    s = superclass
    if "sensory" in s:
        return 0
    if s.startswith("descending"):
        return 4
    if s.startswith("ascending") or "ascending" in s:
        return 5
    if "motor" in s or "efferent" in s or "endocrine" in s:
        return 6
    if s.startswith("ol_") or s.startswith("visual"):
        return 1
    if s.startswith("vnc"):
        return 3
    return 2


def build() -> dict:
    d = load()
    ids = d["ids"]
    ann = pd.read_feather(ANNOTATIONS).set_index("bodyId").reindex(ids)
    loc = ann["somaLocation"].where(ann["somaLocation"].notna(), ann["tosomaLocation"])
    xyz = np.full((len(ids), 3), np.nan, np.float32)
    has = loc.notna().to_numpy()
    xyz[has] = np.stack(loc[has].to_numpy()).astype(np.float32) * VOXEL_UM

    n = len(ids)
    adj = sp.csr_matrix((np.ones(len(d["pre"]), np.float32), (d["pre"], d["post"])), shape=(n, n))
    adj = (adj + adj.T).tocsr()
    for _ in range(4):  # a few passes place neurons whose partners were themselves unplaced
        placed = ~np.isnan(xyz[:, 0])
        if placed.all():
            break
        w = adj @ sp.diags(placed.astype(np.float32))
        total = np.asarray(w.sum(axis=1)).ravel()
        mean = (w @ np.nan_to_num(xyz)) / np.maximum(total, 1)[:, None]
        fill = ~placed & (total > 0)
        xyz[fill] = mean[fill]
    unplaced = np.isnan(xyz[:, 0])
    xyz[unplaced] = np.nanmean(xyz, axis=0)

    region = np.array([region_of(s) for s in d["superclass"]], np.uint8)
    print(f"placed from soma: {has.mean():.1%}, from partners: {(~has & ~unplaced).mean():.1%}, "
          f"fallback: {unplaced.mean():.2%}; extent (um): {np.ptp(xyz, axis=0).round()}")
    return {"xyz": xyz, "region": region}


if __name__ == "__main__":
    np.savez_compressed(POSITIONS, **build())

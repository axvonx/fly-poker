"""Static data for the public play page's brain view, alongside the packed connectomes.

    uv run python tools/export_site_data.py [--out DIR]

Writes web/public/data/neurons.bin (gzipped: xyz float32 (n, 3) then region uint8 (n), the same
bytes flypoker.server serves at /api/neurons) and web/public/data/site.json (the /api/meta fields).
Both are release assets like the connectomes (see .github/workflows/pages.yml), not git files.
"""

from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path

import numpy as np

from flypoker.data import load
from flypoker.positions import POSITIONS, REGIONS

ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=ROOT / "web" / "public" / "data")
    args = ap.parse_args()
    pos = np.load(POSITIONS)
    xyz, region = pos["xyz"].astype("<f4"), pos["region"].astype(np.uint8)
    d = load()
    assert len(region) == len(d["ids"])
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "neurons.bin").write_bytes(gzip.compress(xyz.tobytes() + region.tobytes(), 9, mtime=0))
    meta = {
        "neurons": int(len(region)),
        "regions": list(REGIONS),
        "readout": d["descending"].tolist(),
        "sensory_count": int(len(d["sensory"])),
    }
    (args.out / "site.json").write_text(json.dumps(meta) + "\n")
    print(f"neurons.bin {(args.out / 'neurons.bin').stat().st_size / 1e6:.1f} MB, site.json")


if __name__ == "__main__":
    main()

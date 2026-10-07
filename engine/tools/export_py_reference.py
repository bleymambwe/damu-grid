"""Write reference totals from the Python engine for the browser parity test.

    python tools/export_py_reference.py tests/fixtures/py_reference.json
"""

import json
import sys

from perishnet import Params, make_streams, simulate
from perishnet.advanced import Nowcast
from perishnet.policies import POLICIES

CONFIGS = [
    dict(n=4, L=5, rho=1.1, m=0.6, delay=0, p=5, c=0.3, seed=7),
    dict(n=6, L=5, rho=1.1, m=0.6, delay=2, p=5, c=0.3, seed=11),
    dict(n=6, L=5, rho=1.1, m=0.6, delay=[0, 0, 0, 4, 0, 0], p=5, c=0.3, seed=12),
    dict(n=5, L=4, rho=0.95, m=0.9, delay=[1, 3, 0, 2, 5], p=10, c=0.5, seed=3),
    dict(n=6, L=7, rho=1.3, m=0.3, delay=4, p=8, c=0.1, seed=42),
]
RUNS = [("none", False, False), ("age", False, False), ("age", True, False), ("age", False, True),
        ("age", True, True), ("count", True, True)]


def main(out):
    rows = []
    for c in CONFIGS:
        P = Params(c["n"], c["L"], c["rho"], c["m"], c["delay"], 1.0, c["p"], c["c"], c["seed"])
        st = make_streams(P)
        for pol, now, lease in RUNS:
            fn = Nowcast(POLICIES[pol], q=0.85) if now else pol
            r = simulate(P, fn, st, keep_trace=False, lease=lease)
            rows.append({"config": c, "policy": pol, "nowcast": now, "lease": lease,
                         "waste": r.wasted, "short": r.unmet, "sup": r.supplied, "dem": r.demanded,
                         "moved": r.moved, "conf": r.conflicts, "declined": r.declined, "cost": r.cost})
    with open(out, "w") as f:
        json.dump(rows, f, indent=1)
    print(f"wrote {len(rows)} reference runs to {out}")


if __name__ == "__main__":
    main(sys.argv[1])

"""Reference totals from the blood-group engine for the browser parity test.

    python tools/export_py_groups_reference.py tests/fixtures/py_groups_reference.json
"""

import json
import sys

from perishnet import Params
from perishnet.groups import simulate_groups

CONFIGS = [
    dict(n=6, L=5, rho=1.1, m=0.6, delay=0, p=5, c=0.3, seed=7),
    dict(n=6, L=5, rho=1.1, m=0.6, delay=[0, 0, 0, 0, 4, 3], p=5, c=0.3, seed=12),
    dict(n=4, L=4, rho=0.95, m=0.9, delay=2, p=10, c=0.5, seed=3),
]
RUNS = [("none", False, False, True, "oldest", "platelet"), ("age", False, False, True, "oldest", "platelet"),
        ("age", True, True, True, "oldest", "platelet"), ("age", True, True, False, "exact", "red-cell"),
        ("count", True, False, True, "exact", "platelet"), ("age", False, False, True, "oldest", "red-cell")]


def main(out):
    rows = []
    for c in CONFIGS:
        P = Params(c["n"], c["L"], c["rho"], c["m"], c["delay"], 1.0, c["p"], c["c"], c["seed"], 120)
        for pol, now, lease, reserve, issue, rule in RUNS:
            r = simulate_groups(P, pol, nowcast=now, lease=lease, reserve_neg=reserve, issue=issue, rule=rule)
            rows.append({"config": c, "policy": pol, "nowcast": now, "lease": lease, "reserve": reserve, "issue": issue,
                         "rule": rule, "overrides": r.rh_overrides,
                         "waste": r.wasted, "short": r.unmet, "sup": r.supplied, "dem": r.demanded, "moved": r.moved,
                         "conf": r.conflicts, "declined": r.declined, "subs": r.substitutions,
                         "unmet_by_group": r.unmet_by_group, "cost": r.cost})
    with open(out, "w") as f:
        json.dump(rows, f, indent=1)
    print(f"wrote {len(rows)} blood-group reference runs to {out}")


if __name__ == "__main__":
    main(sys.argv[1])

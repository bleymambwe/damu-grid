"""Blood-group evaluation: 20 held-out seeds, six facilities, Kenyan ABO/RhD mix.

    python tools/groups_eval.py > ../results/groups_eval.txt
"""
import statistics as st
import sys

from perishnet import Params
from perishnet.groups import GROUPS, simulate_groups

sys.stdout.reconfigure(encoding="utf-8")
SETTINGS = {"fresh data": dict(delay=0), "2-day delay": dict(delay=2), "Siaya and Lodwar offline": dict(delay=[0, 0, 0, 0, 4, 3])}
POLICIES = [("no coordination", "none", False, False), ("age-aware rule", "age", False, False),
            ("rule + nowcast + leases", "age", True, True)]
SEEDS = range(101, 121)
print("Blood groups: Kenyan donor ABO/RhD mix, 6 facilities, platelets (5-day shelf life), 365 days, 20 seeds")
print("Issue rule: oldest compatible unit first; RhD-negative units to RhD-positive patients only on their last day\n")
for name, kw in SETTINGS.items():
    print(name)
    for label, pol, now, lease in POLICIES:
        rs = [simulate_groups(Params(seed=s, n_nodes=6, **kw), pol, nowcast=now, lease=lease) for s in SEEDS]
        f = lambda g: st.fmean(g(r) for r in rs)
        print(f"  {label:<26} cost/demand {f(lambda r: r.cost / r.demanded):.3f}   expired {f(lambda r: r.wasted):6.0f}"
              f"   unmet {f(lambda r: r.unmet):6.0f}   O- unmet {f(lambda r: r.unmet_by_group[0]):5.1f}"
              f"   substitutions {f(lambda r: r.substitutions):5.0f}   conflicts {f(lambda r: r.conflicts):6.0f}")
    print()

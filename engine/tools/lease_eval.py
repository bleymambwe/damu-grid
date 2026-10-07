"""Effect of the quota lease layer, with and without the nowcast (20 held-out seeds).

    python tools/lease_eval.py > ../results/lease_eval.txt
"""
import statistics as st, sys
from perishnet import Params, make_streams, simulate
from perishnet.advanced import Nowcast, TunedAgeAware
from perishnet.policies import age_aware
sys.stdout.reconfigure(encoding="utf-8")
SET = {"A0": dict(delay=0), "A2": dict(delay=2), "A4": dict(delay=4), "A-off": dict(delay=[0,0,4,0]),
       "B2": dict(delay=2, rho=0.95, mismatch=0.9, life=4, p=10.0)}
POL = {"π2": lambda: age_aware, "now→π2": lambda: Nowcast(age_aware, 0.85)}
for s, kw in SET.items():
    print(s, kw)
    for name, mk in POL.items():
        for lease in (False, True):
            c, cf, dc = [], [], []
            for seed in range(101, 121):
                P = Params(seed=seed, **kw); r = simulate(P, mk(), make_streams(P), keep_trace=False, lease=lease)
                c.append(r.cost_per_demand); cf.append(r.conflicts); dc.append(r.declined)
            print(f"  {name:8} lease={lease!s:5}  cost/demand {st.fmean(c):.3f}  conflicts {st.fmean(cf):7.1f}  declined {st.fmean(dc):7.1f}")

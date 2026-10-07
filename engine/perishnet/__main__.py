"""Command line: python -m perishnet [options]

Runs all three policies on the same random paths, prints a comparison table,
and writes figures plus an animated network GIF to --out.
"""

import argparse
import json
import sys
from pathlib import Path

from .model import Params
from .policies import LABELS
from .simulate import compare


def main(argv=None):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Windows consoles default to cp1252
    ap =argparse.ArgumentParser(prog="perishnet", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--nodes", type=int, default=4)
    ap.add_argument("--life", type=int, default=5)
    ap.add_argument("--rho", type=float, default=1.1, help="total supply / total demand")
    ap.add_argument("--mismatch", type=float, default=0.6, help="share of supply landing on node 1")
    ap.add_argument("--delay", type=int, default=0, help="periods of stale information")
    ap.add_argument("--p", type=float, default=5.0, help="cost per unmet demand (waste costs 1)")
    ap.add_argument("--c", type=float, default=0.3, help="cost per item moved")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--horizon", type=int, default=365)
    ap.add_argument("--out", default="outputs")
    ap.add_argument("--no-plots", action="store_true")
    ap.add_argument("--no-gif", action="store_true")
    a = ap.parse_args(argv)

    P = Params(a.nodes, a.life, a.rho, a.mismatch, a.delay, 1.0, a.p, a.c, a.seed, a.horizon)
    results = compare(P)

    print(f"N={P.n_nodes} L={P.life} rho={P.rho} m={P.mismatch} delay={P.delay} p={P.p} c={P.c} "
          f"seed={P.seed} T={P.horizon}  beta={P.beta:.3f} targets={P.target}")
    print(f"{'policy':<20}{'wasted %':>10}{'unmet %':>10}{'moved/t':>10}{'conflicts':>11}{'cost/demand':>13}")
    for name, r in results.items():
        print(f"{LABELS[name]:<20}{100 * r.waste_rate:>10.1f}{100 * r.unmet_rate:>10.1f}"
              f"{r.moved / P.horizon:>10.2f}{r.conflicts:>11d}{r.cost_per_demand:>13.3f}")

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    summary = {n: {"waste_rate": r.waste_rate, "unmet_rate": r.unmet_rate, "moved": r.moved,
                   "conflicts": r.conflicts, "cost": r.cost, "cost_per_demand": r.cost_per_demand}
               for n, r in results.items()}
    (out / "summary.json").write_text(json.dumps(summary, indent=2))

    if not a.no_plots:
        from . import viz
        viz.fig_cumulative_cost(results, out / "cumulative_cost.png")
        viz.fig_rates(results, out / "rates.png")
        viz.fig_stock_age(results, P, out / "stock_age.png")
        viz.fig_delay_sweep(P, out / "delay_sweep.png")
        if not a.no_gif:
            viz.animate_network(results, P, out / "network.gif")
        print(f"figures written to {out.resolve()}")


if __name__ == "__main__":
    main()

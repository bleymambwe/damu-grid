"""Tune on training seeds, evaluate on held-out seeds, compare with the hindsight bound.

    python -m perishnet.benchmark --out outputs/benchmark      (about 30 minutes on 4 cores)
    python -m perishnet.benchmark --quick                      (smoke run, a few minutes)
"""

import argparse
import itertools
import json
import math
import statistics
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from .advanced import BandRescue, Nowcast, SAALookahead, TunedAgeAware, hindsight_bound
from .model import Params, make_streams
from .policies import age_aware, balance_counts, no_transfer
from .simulate import simulate

SETTINGS = {
    "A0": dict(delay=0),
    "A2": dict(delay=2),
    "A4": dict(delay=4),
    "B0": dict(delay=0, rho=0.95, mismatch=0.9, life=4, p=10.0),
    "B2": dict(delay=2, rho=0.95, mismatch=0.9, life=4, p=10.0),
}
FAMILY = {"A0": "A", "A2": "A", "A4": "A", "B0": "B", "B2": "B"}


def make_params(setting, seed):
    return Params(seed=seed, **SETTINGS[setting])


def build(spec):
    """Policies are described by picklable tuples and built inside each worker."""
    kind = spec[0]
    if kind == "none":
        return no_transfer
    if kind == "count":
        return balance_counts
    if kind == "age":
        return age_aware
    if kind == "age_t":
        return TunedAgeAware(cover=spec[1], beta=spec[2])
    if kind == "band":
        return BandRescue(band=spec[1])
    if kind == "saa":
        return SAALookahead(horizon=spec[1], scenarios=spec[2], terminal=spec[3])
    if kind == "now":
        return Nowcast(build(spec[2]), q=spec[1])
    raise ValueError(spec)


def run_one(job):
    setting, seed, spec = job
    P = make_params(setting, seed)
    r = simulate(P, build(spec), make_streams(P), keep_trace=False)
    return {"setting": setting, "seed": seed, "spec": list(spec), "cost": r.cost, "demand": r.demanded,
            "cpd": r.cost_per_demand, "waste_rate": r.waste_rate, "unmet_rate": r.unmet_rate,
            "moved": r.moved, "conflicts": r.conflicts}


def bound_one(job):
    family, seed = job
    setting = "A0" if family == "A" else "B0"
    P = make_params(setting, seed)
    st = make_streams(P)
    lb = hindsight_bound(P, st)
    return {"family": family, "seed": seed, "bound": lb, "demand": sum(map(sum, st[1]))}


def mean_ci(xs):
    m = statistics.fmean(xs)
    if len(xs) < 2:
        return m, 0.0
    t = {2: 12.71, 3: 4.30, 4: 3.18, 5: 2.78, 6: 2.57, 8: 2.36, 10: 2.26, 12: 2.20, 20: 2.09}.get(len(xs), 1.96)
    return m, t * statistics.stdev(xs) / math.sqrt(len(xs))


def run_jobs(pool, fn, jobs, label):
    t0 = time.time()
    out = list(pool.map(fn, jobs, chunksize=1))
    print(f"  {label}: {len(jobs)} runs in {time.time() - t0:.0f}s", flush=True)
    return out


def pick(results, specs, settings):
    """Spec with the lowest mean cost per demand over the given settings."""
    score = {}
    for spec in specs:
        rows = [r["cpd"] for r in results if tuple(r["spec"]) == spec and r["setting"] in settings]
        score[spec] = statistics.fmean(rows)
    best = min(score, key=score.get)
    return best, {json.dumps(list(k)): v for k, v in score.items()}


def main(argv=None):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="outputs/benchmark")
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--workers", type=int, default=4)
    a = ap.parse_args(argv)
    train = [1, 2, 3] if a.quick else [1, 2, 3, 4, 5, 6]
    test = [101, 102, 103] if a.quick else list(range(101, 121))
    saa_train = train[:3]
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    log = {"train_seeds": train, "test_seeds": test, "settings": SETTINGS, "tuning": {}}

    with ProcessPoolExecutor(a.workers) as pool:
        print("tuning", flush=True)
        grid_age = [("age_t", c, b) for c, b in itertools.product([1.0, 1.5, 2.0, 3.0], [0.5, 0.7, 0.833, 0.9, 0.95])]
        grid_band = [("band", b) for b in [0.5, 1.0, 1.5, 2.0, 3.0]]
        grid_saa = [("saa", 3, 16, th) for th in [0.0, 0.5, 1.0]]
        res = run_jobs(pool, run_one, [(s, sd, g) for s in ("A0", "B0") for sd in train for g in grid_age + grid_band], "age/band grid")
        best_age, log["tuning"]["age"] = pick(res, grid_age, {"A0", "B0"})
        best_band, log["tuning"]["band"] = pick(res, grid_band, {"A0", "B0"})
        res_saa = run_jobs(pool, run_one, [(s, sd, g) for s in ("A0", "B0") for sd in saa_train for g in grid_saa], "saa grid")
        best_saa, log["tuning"]["saa"] = pick(res_saa, grid_saa, {"A0", "B0"})
        grid_now = [("now", q, best_age) for q in [0.5, 0.7, 0.85, 0.95]]
        res_now = run_jobs(pool, run_one, [(s, sd, g) for s in ("A2", "A4", "B2") for sd in train for g in grid_now], "nowcast grid")
        best_now_q = pick(res_now, grid_now, {"A2", "A4", "B2"})[0][1]
        log["tuning"]["nowcast_q"] = best_now_q
        log["chosen"] = {"age": best_age, "band": best_band, "saa": best_saa, "nowcast_q": best_now_q}
        print("chosen", log["chosen"], flush=True)

        print("evaluating", flush=True)
        base = [("none",), ("count",), ("age",), best_age, best_band, best_saa]
        delayed = [("now", best_now_q, ("count",)), ("now", best_now_q, ("age",)), ("now", best_now_q, best_age),
                   ("now", best_now_q, best_band), ("now", best_now_q, best_saa)]
        jobs = []
        for s in SETTINGS:
            specs = base + (delayed if SETTINGS[s]["delay"] else [])
            jobs += [(s, sd, sp) for sd in test for sp in specs]
        evals = run_jobs(pool, run_one, jobs, "test runs")
        bounds = run_jobs(pool, bound_one, [(f, sd) for f in ("A", "B") for sd in test], "hindsight bounds")

    bmap = {(b["family"], b["seed"]): b for b in bounds}
    summary = {}
    for s in SETTINGS:
        rows = [r for r in evals if r["setting"] == s]
        ref = {r["seed"]: r["cpd"] for r in rows if r["spec"] == ["age"]}
        specs = []
        for r in rows:
            if r["spec"] not in specs:
                specs.append(r["spec"])
        summary[s] = []
        for sp in specs:
            rs = [r for r in rows if r["spec"] == sp]
            cpd = [r["cpd"] for r in rs]
            gap = [(r["cost"] - bmap[FAMILY[s], r["seed"]]["bound"]) / bmap[FAMILY[s], r["seed"]]["bound"] for r in rs]
            diff = [r["cpd"] - ref[r["seed"]] for r in rs]
            m, ci = mean_ci(cpd)
            gm, gci = mean_ci(gap)
            dm, dci = mean_ci(diff)
            summary[s].append({"spec": sp, "cpd": m, "cpd_ci": ci, "gap": gm, "gap_ci": gci,
                               "vs_age": dm, "vs_age_ci": dci,
                               "waste_rate": statistics.fmean(r["waste_rate"] for r in rs),
                               "unmet_rate": statistics.fmean(r["unmet_rate"] for r in rs),
                               "moved_per_t": statistics.fmean(r["moved"] for r in rs) / 365,
                               "conflicts": statistics.fmean(r["conflicts"] for r in rs)})
        lbs = [bmap[FAMILY[s], sd]["bound"] / bmap[FAMILY[s], sd]["demand"] for sd in test]
        summary[s].append({"spec": ["bound"], "cpd": statistics.fmean(lbs), "cpd_ci": mean_ci(lbs)[1]})

    log["summary"] = summary
    (out / "results.json").write_text(json.dumps({"log": log, "runs": evals, "bounds": bounds}, indent=1))
    for s, rows in summary.items():
        print(f"\n{s}  {SETTINGS[s]}")
        for r in sorted(rows, key=lambda r: r["cpd"]):
            extra = "" if r["spec"] == ["bound"] else (f"  gap {100 * r['gap']:5.1f}%  vs π2 {r['vs_age']:+.3f}±{r['vs_age_ci']:.3f}"
                                                         f"  conflicts {r['conflicts']:.0f}")
            print(f"  {json.dumps(r['spec']):<42} {r['cpd']:.3f}±{r['cpd_ci']:.3f}{extra}")


if __name__ == "__main__":
    main()

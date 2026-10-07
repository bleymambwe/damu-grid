import json
from pathlib import Path

import pytest

from perishnet import Params, at_risk, compare, simulate, spare_capacity
from perishnet.rng import poisson_quantile

FIXTURE = Path(__file__).parent / "fixtures" / "js_reference.json"


@pytest.mark.parametrize("case", json.loads(FIXTURE.read_text()))
def test_matches_browser_simulator(case):
    """Python and the dashboard's JavaScript give identical results for the same seed."""
    c = case["params"]
    P = Params(c["n"], c["L"], c["rho"], c["m"], c["d"], 1.0, c["p"], c["c"], c["seed"])
    results = compare(P, keep_trace=False)
    for name, ref in case["results"].items():
        r = results[name]
        assert (r.wasted, r.unmet, r.supplied, r.demanded, r.moved, r.conflicts) == (
            ref["waste"], ref["short"], ref["sup"], ref["dem"], ref["moved"], ref["conf"])
        assert r.cost == pytest.approx(ref["cost"], rel=1e-12)


@pytest.mark.parametrize("seed", [1, 7, 23])
@pytest.mark.parametrize("policy", ["none", "count", "age"])
def test_items_are_conserved(seed, policy):
    """Every item supplied ends up served, wasted, or still in stock or in transit."""
    P = Params(seed=seed, horizon=120, delay=2)
    r = simulate(P, policy)
    served = r.demanded - r.unmet
    in_stock = sum(sum(v) for v in r.trace[-1].stock_end)
    # Items moved in the final period have not landed yet; any that expired on the way are already waste.
    in_transit = sum(k for (_, _, _, k) in r.trace[-1].transfers)
    assert served + r.wasted + in_stock <= r.supplied <= served + r.wasted + in_stock + in_transit


@pytest.mark.parametrize("policy", ["count", "age"])
def test_no_conflicts_with_fresh_information(policy):
    """With delay 0 a policy never asks for items that are not there."""
    for seed in range(1, 11):
        assert simulate(Params(seed=seed, delay=0), policy, keep_trace=False).conflicts == 0


def test_stock_never_negative():
    r = simulate(Params(delay=4, seed=11), "age")
    for p in r.trace:
        assert all(k >= 0 for v in p.stock_end for k in v)


def test_age_aware_beats_no_transfer_with_fresh_information():
    for seed in range(1, 11):
        res = compare(Params(seed=seed), keep_trace=False)
        assert res["age"].cost < res["none"].cost


def test_at_risk_worked_example():
    """Node with lam = 2: stock 3 items with 1 left, 2 with 2 left, 5 with 3 left.

    Bucket sizes lam*r = 2, 4, 6. Fill oldest first:
      r=1: room 2 -> 2 safe, 1 at risk
      r=2: room 4-2=2 -> 2 safe, 0 at risk
      r=3: room 6-4=2 -> 2 safe, 3 at risk
    """
    assert at_risk([0, 3, 2, 5], 2, 3) == [0, 1, 0, 3]


def test_spare_capacity_worked_example():
    """Node with lam = 5 holding 4 items with 3 left can absorb 5*3 - 4 = 11 more of that age."""
    x = [[0, 0, 0, 0], [0, 0, 0, 4]]
    inc = [[0] * 4, [0] * 4]
    assert spare_capacity(x, inc, 5, 1, 3) == 11


def test_target_is_poisson_quantile():
    # lam = 4 per period, two periods of cover -> Poisson(8); beta = 5/6
    assert poisson_quantile(8, 5 / 6) == 11

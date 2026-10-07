import pytest

from perishnet import Params, make_streams, simulate
from perishnet.advanced import BandRescue, Nowcast, SAALookahead, TunedAgeAware, hindsight_bound, nowcast
from perishnet.policies import age_aware


def short(**kw):
    return Params(horizon=60, **kw)


def test_nowcast_is_identity_without_delay():
    P = short()
    obs = [[0, 1, 2, 3, 4, 5]] * 4
    assert nowcast(obs, P, []) == obs


def test_nowcast_wrapper_matches_base_policy_without_delay():
    P = short(seed=3)
    st = make_streams(P)
    a = simulate(P, "age", st, keep_trace=False)
    b = simulate(P, Nowcast(age_aware, q=0.7), st, keep_trace=False)
    assert (a.cost, a.moved) == (b.cost, b.moved)


def test_tuned_age_aware_with_default_constants_matches_pi2():
    P = short(seed=5)
    st = make_streams(P)
    a = simulate(P, "age", st, keep_trace=False)
    b = simulate(P, TunedAgeAware(cover=2.0, beta=None), st, keep_trace=False)
    assert a.cost == b.cost


@pytest.mark.parametrize("policy", [BandRescue(1.0), TunedAgeAware(1.5, 0.9)])
def test_new_policies_have_no_conflicts_with_fresh_information(policy):
    assert simulate(short(seed=9), policy, keep_trace=False).conflicts == 0


def test_nowcast_reduces_conflicts_under_delay():
    P = Params(seed=4, delay=3, horizon=150)
    st = make_streams(P)
    raw = simulate(P, "age", st, keep_trace=False).conflicts
    now = simulate(P, Nowcast(age_aware, q=0.85), st, keep_trace=False).conflicts
    assert now < raw


@pytest.mark.parametrize("seed", [1, 2])
def test_hindsight_bound_is_below_every_policy(seed):
    P = short(seed=seed)
    st = make_streams(P)
    lb = hindsight_bound(P, st)
    for pol in ["none", "count", "age", BandRescue(1.0)]:
        assert simulate(P, pol, st, keep_trace=False).cost >= lb - 1e-6


def test_saa_lookahead_runs_and_respects_stock():
    P = Params(seed=2, horizon=15)
    r = simulate(P, SAALookahead(horizon=2, scenarios=4), keep_trace=False)
    assert r.conflicts == 0


def test_lease_layer_removes_conflicts_under_delay():
    P = Params(seed=8, delay=3, horizon=150)
    st = make_streams(P)
    raw = simulate(P, "age", st, keep_trace=False)
    leased = simulate(P, "age", st, keep_trace=False, lease=True)
    assert raw.conflicts > 0
    assert leased.conflicts == 0 and leased.declined > 0


def test_lease_never_grants_more_than_the_sender_holds():
    from perishnet.simulate import lease_grants
    P = Params()
    inv = [[0, 0, 2, 0, 0, 1]] + [[0] * 6 for _ in range(3)]
    granted, declined = lease_grants([(0, 1, 2, 5), (0, 2, 5, 3)], inv, P)
    for i, j, r, k in granted:
        assert k <= inv[i][r]
    assert sum(k for *_, k in granted) + declined == 8


def test_uniform_delay_list_equals_scalar_delay():
    st = make_streams(Params(seed=6, horizon=90))
    a = simulate(Params(seed=6, horizon=90, delay=2), Nowcast(age_aware, 0.85), st, keep_trace=False)
    b = simulate(Params(seed=6, horizon=90, delay=[2, 2, 2, 2]), Nowcast(age_aware, 0.85), st, keep_trace=False)
    assert a.cost == b.cost


def test_one_offline_node_with_nowcast_and_lease_has_no_conflicts():
    r = simulate(Params(seed=21, n_nodes=6, delay=[0, 0, 0, 4, 0, 0]), Nowcast(age_aware, 0.85), keep_trace=False, lease=True)
    assert r.conflicts == 0


def test_delay_list_must_match_node_count():
    with pytest.raises(ValueError):
        Params(delay=[1, 2])

import pytest

from perishnet import Params, make_streams
from perishnet.groups import (GROUPS, KENYA_SHARES, compatible, donor_order, simulate_groups, split_streams)


def test_shares_sum_to_one_and_follow_kenyan_donor_study():
    assert sum(KENYA_SHARES) == pytest.approx(1.0)
    share = dict(zip(GROUPS, KENYA_SHARES))
    assert share["O+"] > share["A+"] > share["B+"] > share["AB+"] > share["O-"]


@pytest.mark.parametrize("donor,recipient,ok", [
    ("O-", "AB+", True), ("O-", "A-", True), ("O+", "A+", True), ("A+", "AB+", True),
    ("O+", "O-", False), ("A+", "A-", False), ("A-", "B-", False), ("AB+", "O+", False), ("B+", "A+", False),
])
def test_red_cell_compatibility_rule(donor, recipient, ok):
    assert compatible(donor, recipient) is ok


def test_donor_order_puts_own_group_first_and_o_negative_last():
    for g in GROUPS:
        order = [GROUPS[k] for k in donor_order(g, KENYA_SHARES)[0]]
        assert order[0] == g
        assert order[-1] == "O-"
        assert all(compatible(d, g) for d in order)
    assert [GROUPS[k] for k in donor_order("O-", KENYA_SHARES)[0]] == ["O-"]


def test_split_streams_preserves_daily_totals():
    P = Params(seed=5, horizon=40)
    S, D = make_streams(P)
    ST, DT = split_streams(P, (S, D), KENYA_SHARES)
    for i in range(P.n_nodes):
        for t in range(P.horizon):
            assert sum(ST[i][k][t] for k in range(8)) == S[i][t]
            assert sum(DT[i][k][t] for k in range(8)) == D[i][t]


def test_coordination_beats_no_coordination_with_blood_groups():
    for seed in (1, 2, 3):
        P = Params(seed=seed, n_nodes=6, horizon=200)
        assert simulate_groups(P, "age").cost < simulate_groups(P, "none").cost


def test_leases_remove_conflicts_with_blood_groups():
    P = Params(seed=4, n_nodes=6, horizon=150, delay=[0, 0, 0, 0, 4, 3])
    assert simulate_groups(P, "age", nowcast=True, lease=True).conflicts == 0


def test_rh_negative_reservation_protects_rh_negative_patients():
    worse = 0
    for seed in range(1, 7):
        P = Params(seed=seed, n_nodes=6, horizon=250)
        free = simulate_groups(P, "age", reserve_neg=False, rule="red-cell").unmet_by_group[0]
        kept = simulate_groups(P, "age", reserve_neg=True, rule="red-cell").unmet_by_group[0]
        worse += kept > free
    assert worse <= 1


def test_platelet_override_is_rh_positive_abo_compatible_and_only_for_rh_negative_patients():
    from perishnet.groups import override_order
    from perishnet.groups import abo_compatible
    for g in GROUPS:
        cands = [GROUPS[k] for k in override_order(g, KENYA_SHARES)]
        if g.endswith("+"):
            assert cands == []
        else:
            assert cands and all(c.endswith("+") and abo_compatible(c, g) for c in cands)
            assert cands[0] == g[:-1] + "+"


def test_platelet_rule_cuts_rh_negative_shortages_and_red_cell_rule_never_overrides():
    neg = [k for k, g in enumerate(GROUPS) if g.endswith("-")]
    for seed in (1, 2, 3):
        P = Params(seed=seed, n_nodes=6, horizon=200)
        strict = simulate_groups(P, "age", rule="red-cell")
        plt = simulate_groups(P, "age", rule="platelet")
        assert strict.rh_overrides == 0
        assert sum(plt.unmet_by_group[k] for k in neg) < sum(strict.unmet_by_group[k] for k in neg)

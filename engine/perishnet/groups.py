"""ABO/RhD blood groups on top of the single-product engine.

Stock becomes x[i][g][r]: units at facility i of blood group g with r days left.

* Transfers, nowcast and quota leases run per blood group, reusing the tested
  single-product functions with demand and supply scaled by that group's share.
* At the bedside a request of group g is served with group g first, then with
  compatible substitutes (most plentiful first, O- last). By default the oldest
  compatible unit is used first. RhD-negative requests are served first because
  they have the fewest options.
* RhD-negative units go to RhD-positive patients only on their last day
  (reserve_neg), so they stay available for RhD-negative patients.

Two compatibility rules (both are parameters a blood service sets clinically):

  rule="red-cell"  strict: ABO-compatible and RhD-negative patients get only
                   RhD-negative units.
  rule="platelet"  as red-cell, plus a last resort: when no RhD-negative unit is
                   available, an RhD-negative patient may receive an ABO-compatible
                   RhD-positive unit. Each such issue is counted in `rh_overrides`
                   and flagged "anti-D prophylaxis advised for girls and women of
                   childbearing potential" (UK BSH guidance on platelet transfusion;
                   NZ Blood Service transfusion medicine handbook 4.9).

Default shares: voluntary donors across 20 Kenyan sites (O 51.75%, A 24.25%,
B 18.75%, AB 5.5%; RhD+ 93%, RhD- 5%, weak D 2%, counted as D+ for donors),
Murang'a University repository, handle 123456789/4578. Normalised to sum to 1.
"""

from copy import copy

from .advanced import Nowcast
from .model import Params, make_streams
from .policies import POLICIES
from .rng import Mulberry32, poisson_quantile
from .simulate import Result, lease_grants

GROUPS = ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"]
_RAW = {"O-": 3.5, "O+": 48.25, "A-": 0.5, "A+": 23.5, "B-": 1.0, "B+": 17.5, "AB-": 0.0, "AB+": 5.5}
_TOTAL = sum(_RAW[g] for g in GROUPS)
KENYA_SHARES = [_RAW[g] / _TOTAL for g in GROUPS]
ISSUE_ORDER = [GROUPS.index(g) for g in ["O-", "A-", "B-", "AB-", "O+", "A+", "B+", "AB+"]]


def _abo(g):
    return {"O": set(), "A": {"A"}, "B": {"B"}, "AB": {"A", "B"}}[g[:-1]]


def abo_compatible(donor, recipient):
    return _abo(donor) <= _abo(recipient)


def compatible(donor, recipient):
    """Red-cell rule: donor ABO antigens must be a subset of the recipient's; RhD+ only to RhD+."""
    return abo_compatible(donor, recipient) and (donor.endswith("-") or recipient.endswith("+"))


def donor_order(recipient, shares):
    """Exact group first, then compatible substitutes by descending share, O- always last."""
    k = GROUPS.index(recipient)
    subs = [g for g in GROUPS if g != recipient and compatible(g, recipient) and g != "O-"]
    subs.sort(key=lambda g: (-shares[GROUPS.index(g)], GROUPS.index(g)))
    order = [recipient] + subs
    if recipient != "O-":
        order.append("O-")
    return [GROUPS.index(g) for g in order], k


def override_order(recipient, shares):
    """Platelet last resort for an RhD-negative patient: ABO-compatible RhD-positive groups,
    same ABO first, then by descending share."""
    if recipient.endswith("+"):
        return []
    same = recipient[:-1] + "+"
    cands = [g for g in GROUPS if g.endswith("+") and abo_compatible(g, recipient)]
    cands.sort(key=lambda g: (g != same, -shares[GROUPS.index(g)], GROUPS.index(g)))
    return [GROUPS.index(g) for g in cands]


def group_params(P: Params, share: float) -> Params:
    """Single-product parameters for one blood group: demand and supply scaled by its share."""
    Q = copy(P)
    Q.lam = [l * share for l in P.lam]
    Q.sig = [s * share for s in P.sig]
    Q.target = [poisson_quantile(2 * l, P.beta) for l in Q.lam]
    Q.delays = list(P.delays)
    return Q


def split_streams(P: Params, streams, shares):
    """Split each day's total supply and demand into blood groups (one uniform draw per unit)."""
    S, D = streams
    rand = Mulberry32(P.seed * 104729 + 17)
    cum, acc = [], 0.0
    for s in shares:
        acc += s
        cum.append(acc)
    K = len(shares)

    def split(n):
        out = [0] * K
        for _ in range(n):
            u = rand()
            k = 0
            while k < K - 1 and u >= cum[k]:
                k += 1
            out[k] += 1
        return out

    ST = [[[0] * P.horizon for _ in range(K)] for _ in range(P.n_nodes)]
    DT = [[[0] * P.horizon for _ in range(K)] for _ in range(P.n_nodes)]
    for t in range(P.horizon):
        for i in range(P.n_nodes):
            s = split(S[i][t])
            d = split(D[i][t])
            for k in range(K):
                ST[i][k][t] = s[k]
                DT[i][k][t] = d[k]
    return ST, DT


class GroupResult(Result):
    substitutions: int = 0


def simulate_groups(P: Params, policy="age", nowcast=False, lease=False, q=0.85, shares=None, streams=None,
                    reserve_neg=True, issue="oldest", rule="platelet"):
    """Run the network with blood groups.

    Returns a Result with .substitutions, .rh_overrides and .unmet_by_group.
    issue: "oldest" (oldest compatible unit first) or "exact" (own group first).
    rule: "platelet" (RhD-positive last resort for RhD-negative patients) or "red-cell" (strict).
    """
    shares = KENYA_SHARES if shares is None else shares
    K, n, L = len(GROUPS), P.n_nodes, P.life
    base = streams if streams is not None else make_streams(P)
    ST, DT = split_streams(P, base, shares)
    PG = [group_params(P, s) for s in shares]
    fn = POLICIES[policy]
    planners = [Nowcast(fn, q) if nowcast else fn for _ in range(K)]
    orders = [donor_order(g, shares)[0] for g in GROUPS]
    overrides = [override_order(g, shares) if rule == "platelet" else [] for g in GROUPS]

    inv = [[[0] * (L + 1) for _ in range(K)] for _ in range(n)]
    transit = []                                   # [to, group, r, count]
    history = []
    keep = max(P.delays) + 1
    res = GroupResult("groups:" + policy)
    res.substitutions = 0
    res.rh_overrides = 0
    res.unmet_by_group = [0] * K

    for t in range(P.horizon):
        for j, k, r, c in transit:
            inv[j][k][r] += c
        transit = []
        for i in range(n):
            for k in range(K):
                inv[i][k][L] += ST[i][k][t]
                res.supplied += ST[i][k][t]
        history.append([[v[:] for v in node] for node in inv])
        if len(history) > keep:
            history.pop(0)
        h = len(history)
        obs = [history[max(0, h - 1 - P.delays[i])][i] for i in range(n)]

        moved = 0
        for k in range(K):
            plan = planners[k]([obs[i][k] for i in range(n)], PG[k])
            if lease:
                plan, declined = lease_grants(plan, [inv[i][k] for i in range(n)], PG[k])
                res.declined += declined
            for i, j, r, c in plan:
                ok = min(c, inv[i][k][r])
                res.conflicts += c - ok
                if ok > 0:
                    inv[i][k][r] -= ok
                    transit.append([j, k, r, ok])
                    moved += ok
        res.moved += moved

        unmet = 0
        for i in range(n):
            for k in ISSUE_ORDER:
                d = DT[i][k][t]
                res.demanded += d
                # Normal tier: own group and compatible substitutes. RhD-negative units reach
                # RhD-positive patients only on their last day when reserve_neg is set.
                pairs = []
                for donor in orders[k]:
                    last = 1 if (reserve_neg and GROUPS[donor].endswith("-") and GROUPS[k].endswith("+")) else L
                    pairs += [(donor, r) for r in range(1, last + 1)]
                if issue == "oldest":
                    pairs.sort(key=lambda dr: dr[1])          # stable: ties keep donor preference
                # Last-resort tier (platelet rule): ABO-compatible RhD-positive units for RhD-negative patients.
                extra = [(donor, r) for donor in overrides[k] for r in range(1, L + 1)]
                if issue == "oldest":
                    extra.sort(key=lambda dr: dr[1])
                for tier, seq in ((0, pairs), (1, extra)):
                    for donor, r in seq:
                        if d <= 0:
                            break
                        take = min(d, inv[i][donor][r])
                        inv[i][donor][r] -= take
                        d -= take
                        if donor != k:
                            res.substitutions += take
                        if tier == 1:
                            res.rh_overrides += take
                unmet += d
                res.unmet_by_group[k] += d
        res.unmet += unmet

        wasted = 0
        for i in range(n):
            for k in range(K):
                wasted += inv[i][k][1]
                for r in range(1, L):
                    inv[i][k][r] = inv[i][k][r + 1]
                inv[i][k][L] = 0
        still = []
        for tr in transit:
            tr[2] -= 1
            if tr[2] <= 0:
                wasted += tr[3]
            else:
                still.append(tr)
        transit = still
        res.wasted += wasted
        cost = P.h * wasted + P.p * unmet + P.c * moved
        res.cost += cost
        res.cumulative.append(res.cost)
    return res

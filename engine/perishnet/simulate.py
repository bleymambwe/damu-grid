"""Period-by-period simulation.

Each period t, in this order:
    1. items sent last period arrive (one period older)
    2. fresh supply arrives with life L
    3. the policy plans transfers from a snapshot that is `delay` periods old
    4. transfers execute; a request for items that are no longer there is a conflict
    5. demand is served oldest-first; what cannot be served is unmet
    6. everything ages by one period; items reaching zero life are wasted

    cost(t) = h * wasted(t) + p * unmet(t) + c * moved(t)
"""

from collections import deque
from dataclasses import dataclass, field

from .model import Params, make_streams
from .policies import POLICIES, at_risk


@dataclass
class Period:
    t: int
    stock_start: list          # x[i][r] after arrivals and supply
    transfers: list            # executed (from, to, r, count)
    demand: list
    unmet: list
    wasted: list               # per node, including items that expired on the way to it
    stock_end: list            # x[i][r] after ageing
    cost: float


@dataclass
class Result:
    policy: str
    wasted: int = 0
    unmet: int = 0
    supplied: int = 0
    demanded: int = 0
    moved: int = 0
    conflicts: int = 0         # units requested from a node that no longer had them
    declined: int = 0          # units a sender refused under the quota layer (safe, by design)
    cost: float = 0.0
    cumulative: list = field(default_factory=list)
    trace: list = field(default_factory=list)

    @property
    def waste_rate(self):
        return self.wasted / max(1, self.supplied)

    @property
    def unmet_rate(self):
        return self.unmet / max(1, self.demanded)

    @property
    def cost_per_demand(self):
        return self.cost / max(1, self.demanded)


def lease_grants(plan, inv, P):
    """Quota layer: each sender checks a transfer request against its own fresh stock.

    A sender always releases units that are at risk of expiring locally (bucket
    rule on its current stock). Beyond those, it releases only units above its
    own target, so a stale hub can never strip a node of what it needs. Every
    granted unit physically exists, so nothing is promised twice.
    Returns (granted plan, units declined).
    """
    n, life = P.n_nodes, P.life
    left = [v[:] for v in inv]
    risk = [at_risk(inv[i], P.lam[i], life) for i in range(n)]
    budget = [max(0, sum(inv[i]) - sum(risk[i]) - P.target[i]) for i in range(n)]
    granted, declined = [], 0
    for i, j, r, k in plan:
        g = min(k, left[i][r])
        from_risk = min(g, risk[i][r])
        from_budget = min(g - from_risk, budget[i])
        ok = from_risk + from_budget
        risk[i][r] -= from_risk
        budget[i] -= from_budget
        left[i][r] -= ok
        declined += k - ok
        if ok > 0:
            granted.append((i, j, r, ok))
    return granted, declined


def simulate(P: Params, policy: str, streams=None, keep_trace=True, lease=False) -> Result:
    """`policy` is a name from POLICIES or any callable plan(obs, P) -> [(i, j, r, k)].

    Node i is observed with a delay of P.delays[i] periods. With lease=True every
    planned transfer passes through `lease_grants` at the sending node first.
    """
    S, D = streams if streams is not None else make_streams(P)
    plan_fn = POLICIES[policy] if isinstance(policy, str) else policy
    n, life = P.n_nodes, P.life
    inv = [[0] * (life + 1) for _ in range(n)]
    transit = []                                  # (to, r, count) arriving next period
    history = deque()
    keep = max(P.delays) + 1
    res = Result(policy if isinstance(policy, str) else getattr(policy, "__name__", "custom"))

    for t in range(P.horizon):
        for j, r, k in transit:
            inv[j][r] += k
        transit = []
        for i in range(n):
            inv[i][life] += S[i][t]
            res.supplied += S[i][t]
        start = [v[:] for v in inv]

        history.append(start)
        if len(history) > keep:
            history.popleft()
        h = len(history)
        obs = [history[max(0, h - 1 - P.delays[i])][i] for i in range(n)]
        plan = plan_fn(obs, P)
        if lease:
            plan, declined = lease_grants(plan, inv, P)
            res.declined += declined

        done, moved = [], 0
        for i, j, r, k in plan:
            ok = min(k, inv[i][r])
            res.conflicts += k - ok
            if ok > 0:
                inv[i][r] -= ok
                transit.append([j, r, ok])
                done.append((i, j, r, ok))
                moved += ok
        res.moved += moved

        unmet = [0] * n
        for i in range(n):
            d = D[i][t]
            res.demanded += d
            r = 1
            while r <= life and d > 0:
                k = min(d, inv[i][r])
                inv[i][r] -= k
                d -= k
                r += 1
            unmet[i] = d
        res.unmet += sum(unmet)

        wasted = [0] * n
        for i in range(n):
            wasted[i] += inv[i][1]
            for r in range(1, life):
                inv[i][r] = inv[i][r + 1]
            inv[i][life] = 0
        still = []
        for tr in transit:
            tr[1] -= 1
            if tr[1] <= 0:
                wasted[tr[0]] += tr[2]
            else:
                still.append(tr)
        transit = still
        res.wasted += sum(wasted)

        cost = P.h * sum(wasted) + P.p * sum(unmet) + P.c * moved
        res.cost += cost
        res.cumulative.append(res.cost)
        if keep_trace:
            res.trace.append(Period(t, start, done, [D[i][t] for i in range(n)],
                                    unmet, wasted, [v[:] for v in inv], cost))
    return res


def compare(P: Params, keep_trace=True):
    """Run every policy on the same supply and demand paths."""
    streams = make_streams(P)
    return {name: simulate(P, name, streams, keep_trace) for name in POLICIES}


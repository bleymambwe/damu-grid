"""Research-derived policies and the perfect-information bound.

Each class is a stateful policy: create a fresh instance per simulation run.

    Nowcast         control theory: a Smith-predictor-style state estimate that rolls a
                    stale snapshot forward through the known dynamics before deciding.
    BandRescue      quantitative finance: the no-trade band from portfolio rebalancing
                    with transaction costs, applied to "periods of cover", after the
                    age-aware rescue step.
    SAALookahead    stochastic programming: a rolling-horizon two-stage sample-average
                    LP (Powell's direct lookahead class), re-solved every period.
    hindsight_bound information relaxation: the full-horizon LP with the future known.
                    No non-anticipative policy can beat it on the same sample path.
"""

from collections import deque
from copy import copy
from math import floor

import numpy as np
from scipy.optimize import linprog
from scipy.sparse import coo_matrix

from .policies import age_aware, at_risk, spare_capacity
from .rng import poisson_quantile


# --------------------------------------------------------------------------- nowcast
def nowcast(obs, P, plans, q=0.5):
    """Roll a snapshot taken len(plans) periods ago forward to "now".

    For each elapsed period: apply the transfers this policy planned then,
    remove a demand estimate oldest-first, age everything one period, land the
    transfers and the expected supply. Demand is estimated by its q-quantile;
    q > 0.5 makes the estimate of what each node still holds conservative.
    """
    L, n = P.life, P.n_nodes
    x = [[float(k) for k in v] for v in obs]
    dem = [P.lam[i] if q == 0.5 else poisson_quantile(P.lam[i], q) for i in range(n)]
    for plan in plans:
        landing = []
        for i, j, r, k in plan:
            moved = min(k, x[i][r])
            x[i][r] -= moved
            landing.append((j, r - 1, moved))
        for i in range(n):
            d = dem[i]
            for r in range(1, L + 1):
                take = min(d, x[i][r])
                x[i][r] -= take
                d -= take
                if d <= 0:
                    break
            for r in range(1, L):
                x[i][r] = x[i][r + 1]
            x[i][L] = P.sig[i]
        for j, r, k in landing:
            if r >= 1:
                x[j][r] += k
    return [[max(0, floor(v)) for v in row] for row in x]


def nowcast_per_node(obs, P, plans, q=0.5):
    """Nowcast when nodes have different delays: roll node i forward P.delays[i] periods.

    `plans` holds this policy's plans for the last max(delays) periods, oldest first.
    Units arriving from other nodes are counted at their planned quantity.
    """
    L, n = P.life, P.n_nodes
    out = []
    for i in range(n):
        d = P.delays[i]
        x = [float(k) for k in obs[i]]
        dem = P.lam[i] if q == 0.5 else poisson_quantile(P.lam[i], q)
        for plan in (plans[max(0, len(plans) - d):] if d else []):
            landing = []
            for a, b, r, k in plan:
                if a == i:
                    x[r] -= min(k, x[r])
                if b == i:
                    landing.append((r - 1, k))
            left = dem
            for r in range(1, L + 1):
                take = min(left, x[r])
                x[r] -= take
                left -= take
                if left <= 0:
                    break
            for r in range(1, L):
                x[r] = x[r + 1]
            x[L] = P.sig[i]
            for r, k in landing:
                if r >= 1:
                    x[r] += k
        out.append([max(0, floor(v)) for v in x])
    return out


class Nowcast:
    """Wrap any policy so it decides on a nowcast instead of the stale snapshot."""

    def __init__(self, base, q=0.7):
        self.base, self.q, self.plans = base, q, None
        self.__name__ = f"nowcast({getattr(base, '__name__', 'policy')}, q={q})"

    def __call__(self, obs, P):
        dmax = max(P.delays)
        if self.plans is None:
            self.plans = deque(maxlen=dmax)
        if dmax == 0:
            x = obs
        elif min(P.delays) == dmax:
            x = nowcast(obs, P, list(self.plans), self.q)
        else:
            x = nowcast_per_node(obs, P, list(self.plans), self.q)
        plan = self.base(x, P)
        if dmax:
            self.plans.append(plan)
        return plan


# --------------------------------------------------------------------------- tuned age-aware
class TunedAgeAware:
    """pi_2 with its two constants exposed for tuning (a policy function approximation).

    cover  periods of demand each node's target covers (pi_2 uses 2)
    beta   service level for that target (pi_2 uses p / (p + h))
    """

    def __init__(self, cover=2.0, beta=None):
        self.cover, self.beta = cover, beta
        self.__name__ = f"age_aware(cover={cover}, beta={beta})"
        self._P = None

    def __call__(self, obs, P):
        if self._P is None:
            self._P = copy(P)
            beta = P.beta if self.beta is None else self.beta
            self._P.target = [poisson_quantile(self.cover * l, beta) for l in P.lam]
        return age_aware(obs, self._P)


# --------------------------------------------------------------------------- band
class BandRescue:
    """Age-aware rescue, then equalise periods of cover only outside a no-trade band.

    cover_i = stock_i / lam_i. While max cover - min cover > band, move one oldest
    sendable item from the most-covered node to the least-covered node. With a
    per-item transfer cost, small imbalances are cheaper to leave alone, exactly as
    in rebalancing a portfolio under transaction costs.
    """

    def __init__(self, band=2.0):
        self.band = band
        self.__name__ = f"band_rescue(b={band})"

    def __call__(self, obs, P):
        n, L = P.n_nodes, P.life
        x = [v[:] for v in obs]
        incoming = [[0] * (L + 1) for _ in range(n)]
        plan = {}

        def send(i, j, r, k):
            plan[(i, j, r)] = plan.get((i, j, r), 0) + k
            x[i][r] -= k
            incoming[j][r] += k

        risk = [at_risk(x[i], P.lam[i], L) for i in range(n)]
        for r in range(2, L + 1):
            for i in range(n):
                left = risk[i][r]
                while left > 0:
                    best_j, best_cap = -1, 0
                    for j in range(n):
                        if j != i:
                            cap = spare_capacity(x, incoming, P.lam[j], j, r)
                            if cap > best_cap:
                                best_j, best_cap = j, cap
                    if best_j < 0:
                        break
                    k = min(left, best_cap)
                    send(i, best_j, r, k)
                    left -= k

        held = [sum(x[i]) + sum(incoming[i]) for i in range(n)]
        for _ in range(10_000):
            cover = [held[i] / P.lam[i] for i in range(n)]
            hi = max(range(n), key=lambda i: (cover[i], -i))
            lo = min(range(n), key=lambda i: (cover[i], i))
            if cover[hi] - cover[lo] <= self.band:
                break
            r = next((r for r in range(2, L + 1) if x[hi][r] > 0), None)
            if r is None:
                break
            send(hi, lo, r, 1)
            held[hi] -= 1
            held[lo] += 1
        return [(i, j, r, k) for (i, j, r), k in plan.items()]


# --------------------------------------------------------------------------- LP core
def _build_lp(x0, D, S, P, recourse, first_stage_weight=1.0, terminal=0.0):
    """Scenario LP over K periods.

    x0[i][r]   stock now (after arrivals and supply)
    D[s,i,k]   demand in scenario s, period k
    S[s,i,k]   supply landing at the start of period k (k >= 1; k = 0 is in x0)

    Variables per (s, k): use[i,r], left[i,r] (stock carried over), short[i];
    transfers u[i,j,r] (r >= 2) at k = 0 shared by all scenarios, and per-scenario
    transfers at 1 <= k <= K-2 when recourse=True. Items age one period in transit.
    Cost: mean over scenarios of p*short + h*expired, plus c per item moved.
    terminal > 0 adds a cost-function approximation of the world after the horizon:
    each node pays terminal*p per item its usable end stock falls short of target.
    """
    Sc, n, K = D.shape
    L = P.life
    pairs = [(i, j) for i in range(n) for j in range(n) if i != j]
    ages = range(2, L + 1)
    cost, nv = [], 0

    def new(c):
        nonlocal nv
        cost.append(c)
        nv += 1
        return nv - 1

    u0 = {(i, j, r): new(P.c * first_stage_weight) for (i, j) in pairs for r in ages}
    w = 1.0 / Sc
    use, left, short, uk = {}, {}, {}, {}
    for s in range(Sc):
        for k in range(K):
            for i in range(n):
                short[s, k, i] = new(w * P.p)
                for r in range(1, L + 1):
                    use[s, k, i, r] = new(0.0)
                    left[s, k, i, r] = new(w * P.h if r == 1 else 0.0)
            if recourse and 1 <= k <= K - 2:
                for (i, j) in pairs:
                    for r in ages:
                        uk[s, k, i, j, r] = new(w * P.c)

    rows, cols, vals, rhs = [], [], [], []
    row = 0

    def add(entries, b):
        nonlocal row
        for col, v in entries:
            rows.append(row)
            cols.append(col)
            vals.append(v)
        rhs.append(b)
        row += 1

    def transfer(s, k, i, j, r):
        if k == 0:
            return u0.get((i, j, r))
        return uk.get((s, k, i, j, r))

    for s in range(Sc):
        for k in range(K):
            for i in range(n):
                add([(use[s, k, i, r], 1.0) for r in range(1, L + 1)] + [(short[s, k, i], 1.0)], float(D[s, i, k]))
                for r in range(1, L + 1):
                    e = [(use[s, k, i, r], 1.0), (left[s, k, i, r], 1.0)]
                    if r >= 2:
                        for j in range(n):
                            if j != i:
                                col = transfer(s, k, i, j, r)
                                if col is not None:
                                    e.append((col, 1.0))
                    if k == 0:
                        b = float(x0[i][r])
                    else:
                        b = float(S[s, i, k]) if r == L else 0.0
                        if r < L:
                            e.append((left[s, k - 1, i, r + 1], -1.0))
                            for j in range(n):
                                if j != i:
                                    col = transfer(s, k - 1, j, i, r + 1)
                                    if col is not None:
                                        e.append((col, -1.0))
                    add(e, b)
    if terminal > 0:
        # gap >= target - usable end stock  <=>  gap + sum(left[r >= 2]) - slack = target
        for s in range(Sc):
            for i in range(n):
                gap, slack = new(w * terminal * P.p), new(0.0)
                e = [(gap, 1.0), (slack, -1.0)] + [(left[s, K - 1, i, r], 1.0) for r in range(2, L + 1)]
                add(e, float(P.target[i]))
    A = coo_matrix((vals, (rows, cols)), shape=(row, nv)).tocsr()
    return np.array(cost), A, np.array(rhs), u0


def _solve(c, A, b, fast=False):
    # Small, repeated LPs: dual simplex without presolve avoids most fixed overhead.
    opts = {"presolve": False} if fast else {}
    res = linprog(c, A_eq=A, b_eq=b, bounds=(0, None), method="highs-ds" if fast else "highs", options=opts)
    if res.status != 0:
        raise RuntimeError(f"LP failed: {res.message}")
    return res


class SAALookahead:
    """Rolling-horizon two-stage sample-average LP, re-solved every period.

    Samples `scenarios` demand and supply paths over `horizon` periods, chooses
    this period's transfers to minimise expected cost, applies them, and repeats
    next period. Fractional transfers are rounded to the nearest whole item
    without exceeding stock.
    """

    def __init__(self, horizon=3, scenarios=16, recourse=False, terminal=0.5, seed=12345):
        self.K, self.Sc, self.recourse, self.terminal = horizon, scenarios, recourse, terminal
        self.rng = np.random.default_rng(seed)
        self.__name__ = f"saa(K={horizon}, S={scenarios}, terminal={terminal})"

    def __call__(self, obs, P):
        n = P.n_nodes
        D = self.rng.poisson(np.array(P.lam)[None, :, None], size=(self.Sc, n, self.K))
        S = self.rng.poisson(np.array(P.sig)[None, :, None], size=(self.Sc, n, self.K))
        c, A, b, u0 = _build_lp(obs, D, S, P, self.recourse, terminal=self.terminal)
        sol = _solve(c, A, b).x
        avail = [v[:] for v in obs]
        plan = []
        for (i, j, r), col in sorted(u0.items(), key=lambda kv: -sol[kv[1]]):
            k = min(int(floor(sol[col] + 0.5)), avail[i][r])
            if k > 0:
                plan.append((i, j, r, k))
                avail[i][r] -= k
        return plan


def hindsight_bound(P, streams):
    """Minimum cost on one sample path if the whole future were known in advance.

    Information relaxation with zero penalty (Brown, Smith & Sun 2010). It is a
    valid lower bound for every policy that cannot see the future, and an LP
    relaxation of the integer problem, which keeps it a lower bound.
    """
    S, D = streams
    n, T, L = P.n_nodes, P.horizon, P.life
    x0 = [[0] * (L + 1) for _ in range(n)]
    for i in range(n):
        x0[i][L] = S[i][0]
    Dm = np.array(D, dtype=float)[None, :, :]
    Sm = np.array(S, dtype=float)[None, :, :]
    c, A, b, _ = _build_lp(x0, Dm, Sm, P, recourse=True)
    return _solve(c, A, b).fun

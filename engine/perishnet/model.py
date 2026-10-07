"""Problem parameters and the random supply/demand paths.

Notation (kept deliberately simple):
    N        number of nodes
    L        life of a fresh item, in periods
    lam[i]   average demand per period at node i
    sig[i]   average supply per period at node i
    h, p, c  cost of one wasted item, one unmet demand, one item moved
"""

from dataclasses import dataclass, field

from .rng import Mulberry32, poisson, poisson_quantile

# Average demand per period for nodes 1..6 (node 1 is the busiest).
BASE_DEMAND = (6, 4, 2.5, 1.5, 1, 0.8)


@dataclass
class Params:
    n_nodes: int = 4
    life: int = 5            # L
    rho: float = 1.1         # total supply / total demand
    mismatch: float = 0.6    # 0 = supply lands where demand is, 1 = all supply lands on node 1
    delay: int = 0           # periods of staleness: one int for every node, or a list per node
    h: float = 1.0           # cost per wasted item
    p: float = 5.0           # cost per unit of unmet demand
    c: float = 0.3           # cost per item moved
    seed: int = 7
    horizon: int = 365       # T
    delays: list = field(init=False)
    lam: list = field(init=False)
    sig: list = field(init=False)
    beta: float = field(init=False)
    target: list = field(init=False)

    def __post_init__(self):
        if not 2 <= self.n_nodes <= len(BASE_DEMAND):
            raise ValueError(f"n_nodes must be between 2 and {len(BASE_DEMAND)}")
        if self.life < 2:
            raise ValueError("life must be at least 2 (items need one period to travel)")
        if isinstance(self.delay, (list, tuple)):
            if len(self.delay) != self.n_nodes:
                raise ValueError("a per-node delay list needs one entry per node")
            self.delays = [int(d) for d in self.delay]
        else:
            self.delays = [int(self.delay)] * self.n_nodes
        self.lam = list(BASE_DEMAND[: self.n_nodes])
        total = 0
        for l in self.lam:
            total += l
        # Supply: a share (1 - m) lands in proportion to demand, a share m lands on node 1.
        self.sig = [
            self.rho * ((1 - self.mismatch) * l + (self.mismatch * total if i == 0 else 0))
            for i, l in enumerate(self.lam)
        ]
        # Critical ratio: how much more a shortage hurts than a waste.
        self.beta = self.p / (self.p + self.h)
        # Stock target per node: cover 2 periods of demand at service level beta.
        self.target = [poisson_quantile(2 * l, self.beta) for l in self.lam]


def max_delay(P: Params) -> int:
    return max(P.delays)


def make_streams(P: Params):
    """Pre-draw supply S[i][t] and demand D[i][t] so every policy faces the same future."""
    rand = Mulberry32(P.seed * 7919 + 13)
    S = [[] for _ in range(P.n_nodes)]
    D = [[] for _ in range(P.n_nodes)]
    for _ in range(P.horizon):
        for i in range(P.n_nodes):
            S[i].append(poisson(P.sig[i], rand))
            D[i].append(poisson(P.lam[i], rand))
    return S, D

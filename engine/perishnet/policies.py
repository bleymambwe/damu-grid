"""Transfer policies.

Stock is stored as x[i][r] = number of items at node i with r periods of life
left (r = 1..L; index 0 is unused). A policy looks at a (possibly stale)
snapshot of x and returns a plan: a list of (from_node, to_node, r, count).

Transfers take one period, so an item with r = 1 would expire on the way and
is never sent.
"""

from math import floor


def no_transfer(obs, P):
    """pi_0: every node keeps what lands on it."""
    return []


def fill_shortfalls(x, P, order, plan, incoming=None):
    """Top up nodes below target from nodes above target.

    target[i] = smallest s with P(two periods of demand <= s) >= beta.
    Items are taken from the sender in the given order of r (life left).
    `incoming` counts items already scheduled to arrive: they count toward the
    receiver's target but cannot be sent onward.
    """
    n = P.n_nodes
    if incoming is None:
        incoming = [[0] * len(v) for v in x]
    sendable = [sum(v) - v[1] for v in x]               # r = 1 items cannot travel
    held = [sum(v) + sum(incoming[i]) for i, v in enumerate(x)]
    surplus, deficit = [], []
    for i in range(n):
        gap = held[i] - P.target[i]
        if gap > 0:
            surplus.append([i, min(gap, sendable[i])])
        elif gap < 0:
            deficit.append([i, -gap])
    deficit.sort(key=lambda d: -d[1])
    for d in deficit:
        need = d[1]
        surplus.sort(key=lambda s: -s[1])
        for s in surplus:
            if need <= 0:
                break
            give = min(need, s[1])
            if give <= 0:
                continue
            for r in order:
                if give <= 0:
                    break
                k = min(give, x[s[0]][r])
                if k > 0:
                    plan.append((s[0], d[0], r, k))
                    x[s[0]][r] -= k
                    incoming[d[0]][r] += k
                    give -= k
                    need -= k
                    s[1] -= k
    return plan


def balance_counts(obs, P):
    """pi_1: fix shortfalls using totals only, sending the freshest items first."""
    x = [v[:] for v in obs]
    order = list(range(P.life, 1, -1))
    return fill_shortfalls(x, P, order, [])


def at_risk(stock, lam, life):
    """Items that will expire before local demand reaches them.

    Under first-in-first-out, a node with average demand lam uses about
    lam * r items in r periods. Fill that 'bucket' from the oldest items
    upward; anything that overflows the bucket for its own r is at risk.

        safe(r) = min( x(r), floor(lam * r) - used_so_far )
        risk(r) = x(r) - safe(r)
    """
    risk = [0] * (life + 1)
    used = 0
    for r in range(1, life + 1):
        room = max(0, floor(lam * r) - used)
        safe = min(stock[r], room)
        risk[r] = stock[r] - safe
        used += safe
    return risk


def spare_capacity(x, incoming, lam, j, r):
    """How many more items with r periods left node j can use in time.

        spare_j(r) = floor(lam_j * r) - (items at j, held or incoming, with <= r left)
    """
    held = 0
    for b in range(1, r + 1):
        held += x[j][b] + incoming[j][b]
    return floor(lam * r) - held


def age_aware(obs, P):
    """pi_2: rescue at-risk items first, then fix shortfalls using the oldest items.

    Step 1  find at-risk items at every node (see `at_risk`).
    Step 2  send each at-risk item to the node with the most spare capacity
            for its remaining life (see `spare_capacity`), oldest first.
    Step 3  run `fill_shortfalls`, taking the oldest sendable items first.
    """
    n, life = P.n_nodes, P.life
    x = [v[:] for v in obs]
    incoming = [[0] * len(v) for v in obs]
    plan = []
    risk = [at_risk(x[i], P.lam[i], life) for i in range(n)]
    for r in range(2, life + 1):
        for i in range(n):
            left = risk[i][r]
            while left > 0:
                best_j, best_cap = -1, 0
                for j in range(n):
                    if j == i:
                        continue
                    cap = spare_capacity(x, incoming, P.lam[j], j, r)
                    if cap > best_cap:
                        best_j, best_cap = j, cap
                if best_j < 0:
                    break
                k = min(left, best_cap)
                plan.append((i, best_j, r, k))
                x[i][r] -= k
                incoming[best_j][r] += k
                left -= k
    return fill_shortfalls(x, P, list(range(2, life + 1)), plan, incoming)


POLICIES = {
    "none": no_transfer,
    "count": balance_counts,
    "age": age_aware,
}

LABELS = {
    "none": "π0 no transfers",
    "count": "π1 balance counts",
    "age": "π2 age-aware",
}

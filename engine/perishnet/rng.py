"""Seeded random numbers that match the browser dashboard bit for bit.

The dashboard uses the mulberry32 generator, so this module reimplements it
with explicit 32-bit arithmetic. Same seed -> same supply and demand paths ->
identical simulation results in Python and JavaScript.
"""

import math

_M32 = 0xFFFFFFFF


def _imul(a: int, b: int) -> int:
    """32-bit integer multiply, like JavaScript's Math.imul."""
    return (a * b) & _M32


class Mulberry32:
    """Tiny, fast 32-bit PRNG. Call the instance to get a float in [0, 1)."""

    def __init__(self, seed: int):
        self.state = seed & _M32

    def __call__(self) -> float:
        self.state = (self.state + 0x6D2B79F5) & _M32
        t = self.state
        t = _imul(t ^ (t >> 15), 1 | t)
        t = ((t + _imul(t ^ (t >> 7), 61 | t)) & _M32) ^ t
        return ((t ^ (t >> 14)) & _M32) / 4294967296


def poisson(lam: float, rand: Mulberry32) -> int:
    """Draw from Poisson(lam). Knuth's method for small lam, normal approximation above 30."""
    if lam <= 0:
        return 0
    if lam < 30:
        limit = math.exp(-lam)
        k, p = 0, 1.0
        while True:
            k += 1
            p *= rand()
            if not p > limit:
                return k - 1
    u = rand() or 1e-12
    v = rand()
    z = math.sqrt(-2 * math.log(u)) * math.cos(2 * math.pi * v)
    return max(0, math.floor(lam + math.sqrt(lam) * z + 0.5))


def poisson_quantile(lam: float, beta: float) -> int:
    """Smallest s with P(D <= s) >= beta for D ~ Poisson(lam)."""
    if lam <= 0:
        return 0
    k, p = 0, math.exp(-lam)
    cdf = p
    while cdf < beta and k < 10000:
        k += 1
        p *= lam / k
        cdf += p
    return k

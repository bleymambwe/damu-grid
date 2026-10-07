# perishnet: age-aware allocation prototype

A small, dependency-light Python simulator for moving perishable, single-use
items around a network of nodes with random demand. It compares three policies
on identical random draws:

| Policy | Idea |
|---|---|
| `none` (π0) | Every node keeps what lands on it. |
| `count` (π1) | Top up nodes below target from nodes above it, sending the freshest items. Ignores age. |
| `age` (π2) | Rescue items that will expire before local demand reaches them, then top up shortfalls with the oldest items. |

## The maths in four lines

- `x[i][r]`: items at node `i` with `r` periods of life left. Each period: `x(r) ← x(r+1) − used`, and new items enter at `r = L`.
- Cost per period: `h·wasted + p·unmet + c·moved`, with critical ratio `β = p / (p + h)`.
- Target stock: smallest `s` with `P(two periods of demand ≤ s) ≥ β` (≈ `μ + z·σ` with `μ = 2λ`, `σ = √(2λ)`).
- At risk: fill a bucket of size `⌊λ·r⌋` from the oldest items up; the overflow at each `r` will expire unused. Send it to the node with the largest `spare_j(r) = ⌊λ_j·r⌋ − (items at j with ≤ r left)`.

## Run

```bash
pip install matplotlib pillow pytest
python -m perishnet                      # defaults: 4 nodes, L=5, seed 7
python -m perishnet --delay 3 --mismatch 0.9 --out outputs_delay3
python -m perishnet --no-gif             # skip the animation (about 1 minute faster)
python -m pytest -q
```

Outputs in `outputs/`: `cumulative_cost.png`, `rates.png`, `stock_age.png`,
`delay_sweep.png`, `network.gif`, `summary.json`.

## Parity with the browser dashboard

`perishnet/rng.py` reimplements the browser's mulberry32 generator with
32-bit arithmetic, so the same settings give identical results in Python and
in the browser. Two checks keep them in step:

```bash
# Demo engine (web/js/engine.js) against Python: nowcast, leases, per-facility delays
python tools/export_py_reference.py tests/fixtures/py_reference.json
node ../web/js/engine.test.js tests/fixtures/py_reference.json

# Explainer page simulator (pages/method.src.html) against tests/fixtures/js_reference.json
node tools/check_js_parity.js ../pages/method.src.html tests/fixtures/js_reference.json
```

## Layout

```
perishnet/
  rng.py         seeded generator, Poisson draw and quantile
  model.py       Params, supply/demand streams
  policies.py    no_transfer, balance_counts, age_aware (+ at_risk, spare_capacity)
  simulate.py    period loop, Result with full trace
  viz.py         matplotlib figures and the network GIF
  __main__.py    command line
tests/           parity, conservation, invariants, worked examples
```

## Limits

- Demand means `λ` are known to the policy. A real system must estimate them, ideally as quantiles.
- Transfers take exactly one period, and every pair of nodes is connected at the same cost.
- The policy is greedy, so it approximates the per-period stochastic program rather than solving it.
- With stale information (`--delay > 0`) the policy over-asks and conflicts appear. The fix is a reservation layer (escrow quotas), which this prototype does not implement.

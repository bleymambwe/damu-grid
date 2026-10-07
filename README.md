# Damu Grid

**Get the right platelet unit to the right fridge before it expires, even when the network is down.**

Damu Grid is a working technical slice of an interoperable blood-bank information system for Africa
(the ABBIS concept), built for the Terumo BCT Africa Hackathon 2026. It covers one priority workflow
end to end: **daily stock rebalancing of platelets between facilities**, under unreliable connectivity,
with every transfer suggested by the engine and approved by a person.

- **Submission overview (start here):** https://blessingsmambwe.web.app/damu-grid/overview
- **Live demo:** https://blessingsmambwe.web.app/damu-grid/
- **How it works (maths, interactive):** https://blessingsmambwe.web.app/damu-grid/method
- **Evidence (research + benchmark):** https://blessingsmambwe.web.app/damu-grid/evidence
- **Submission (the brief's seven deliverables, one section each):** [docs/SUBMISSION.md](docs/SUBMISSION.md)

All data is synthetic. Facility names are real towns; stock, demand and supply are simulated.
No patient or donor data is used anywhere.

## How this answers the brief

| Brief deliverable | Answer | Status |
|---|---|---|
| Problem and user need | Platelets expire on one shelf while patients wait at another; hub data is days old | Grounded in published Kenyan data |
| End-to-end workflow | Record → sync → nowcast → suggest → sender confirms → officer approves → courier | Built in simulation |
| Working technical slice | Live engine in the browser, not static screens | Built |
| System architecture and ABBIS | Damu Grid is the stock-coordination module of ABBIS: consumes unit events, returns suggestions, publishes aggregates | Engine Built; APIs Designed |
| AI and data approach | Nowcast + explainable rule + scenario LP, evaluated on held-out futures with a lower bound | Built |
| Adaptability | Every operational constant is a parameter; FHIR/DHIS2 interfaces | Partly Built |
| Implementation pathway | Shadow-mode pilot with one county hub and 4–6 facilities | Designed |

Details, the failure-mode table and the judging-criteria map: [docs/SUBMISSION.md](docs/SUBMISSION.md).

## The problem in one line

Supply lands where it is collected (mostly at the regional centre), demand appears everywhere, every
unit expires after 5 days, and the hub's view of each facility is often days old. Units expire on one
shelf while patients wait at another. The Strathmore/Lancet Global Health (2026) study of Siaya, Nakuru
and Turkana names this mismatch as one of seven root causes of Kenya's blood crisis.

## What the engine does, in three layers

| Layer | What it does | Where it comes from |
|---|---|---|
| **1. Nowcast** | Rolls each facility's last report forward by its own delay, using expected usage at a cautious (85th-percentile) rate, so decisions use an estimate of *today's* stock. | Control theory (Smith predictor) |
| **2. Decide** | **Age-aware rule:** units that will expire before local demand reaches them go to the facility with the most room to use them in time; then facilities below a two-day safety level are topped up, oldest units first. At the hub, a **rolling scenario LP** (3 days, 16 sampled futures) can replace the rule. | Operations research: perishable transshipment, sample-average approximation |
| **3. Quota leases** | Every transfer is confirmed by the *sending* facility against its live shelf: units at risk are always released, others only above its own safety level. A unit can never be promised twice. | Databases (escrow transactions) |

People approve or reject every suggestion. Each suggestion carries a plain-language reason.

## Evidence (synthetic benchmark, 20 held-out futures per setting)

| Setting | Age-aware rule | + Nowcast | Best stack | Perfect-foresight bound |
|---|---|---|---|---|
| Fresh data | 0.304 | — | 0.299 (scenario LP; a statistical tie with the rule) | 0.203 |
| 2-day data delay | 0.652 | 0.371 | 0.340 (nowcast → LP) | 0.203 |
| 4-day data delay | 0.953 | 0.439 | 0.350 (nowcast → band) | 0.203 |
| Scarce, misplaced supply | 1.635 | — | 1.230 (scenario LP) | 0.788 |

Cost per unit of demand: waste = 1, unmet request = 5 (10 in the scarce setting), transfer = 0.3 per unit.
No coordination costs 2.02 (5.63 when scarce). Quota leases take double-allocation conflicts from 1,619 a year to 0
at a 2-day delay (`results/lease_eval.txt`).
Full tables, confidence intervals and the literature map: [Evidence page](https://blessingsmambwe.web.app/damu-grid/evidence) and `results/`.

## Repository

```
engine/      Python reference engine "perishnet": simulator, policies, nowcast, leases, LP lookahead,
             perfect-information bound, benchmark, figures. 35 tests.
web/         Static demo site (no build step): index.html (control room), method.html, evidence.html,
             js/engine.js (line-for-line port of the Python engine), js/app.js (UI), data/kenya_map.json
pages/       Sources for method.html and evidence.html
results/     Benchmark results, lease evaluation, narrative used on the evidence page
tools/       build_pages.py (builds the secondary pages), build_map.py (Natural Earth -> basemap)
docs/        SUBMISSION.md: the seven hackathon deliverables
```

## Run it

```bash
# Python engine
cd engine
pip install matplotlib pillow scipy pytest
python -m pytest -q                     # 35 tests
python -m perishnet                     # compare policies, write figures to outputs/
python -m perishnet.benchmark           # full benchmark (about 30 min on 4 cores)

# Browser engine must match Python exactly
python tools/export_py_reference.py tests/fixtures/py_reference.json
node ../web/js/engine.test.js tests/fixtures/py_reference.json      # OK: all 30 runs match

# Demo site
cd ..
python -I tools/build_pages.py
python -m http.server -d web 8000       # open http://localhost:8000
```

## Honest limits

- Demand and supply rates are known to the engine; a deployment must estimate them per facility.
- One product with no blood groups; ABO/Rh compatibility is a bipartite matching layer still to add.
- Transfers take one day between any two facilities at the same cost.
- The demo runs the rule live; the LP lookahead is benchmarked in Python, not run in the browser.
- The FHIR/DHIS2 interfaces in `docs/SUBMISSION.md` are a design, not yet implemented.

## Credits and data

Basemap: Natural Earth 1:50m (public domain). Research sources are listed on the evidence page.
Built by Blessings Mambwe. All rights reserved; participants retain IP under the hackathon terms.

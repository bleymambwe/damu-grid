// Parity test for blood groups: the browser GroupSim must reproduce perishnet/groups.py exactly.
//   node web/js/engine.groups.test.js engine/tests/fixtures/py_groups_reference.json
const fs = require('fs');
const E = require('./engine.js');

const ref = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let fail = 0;
for (const row of ref) {
  const c = row.config;
  const sim = new E.GroupSim({ N: c.n, L: c.L, rho: c.rho, m: c.m, delay: c.delay, p: c.p, c: c.c, seed: c.seed, T: 120 },
    { policy: row.policy, nowcast: row.nowcast, lease: row.lease, reserveNeg: row.reserve, issue: row.issue, rule: row.rule, q: 0.85 });
  const t = sim.run();
  const got = [t.waste, t.short, t.sup, t.dem, t.moved, t.conf, t.declined, t.subs, t.overrides].concat(sim.unmetByGroup);
  const want = [row.waste, row.short, row.sup, row.dem, row.moved, row.conf, row.declined, row.subs, row.overrides].concat(row.unmet_by_group);
  const ok = got.every((v, k) => v === want[k]) && Math.abs(t.cost - row.cost) < 1e-6 * Math.max(1, row.cost);
  if (!ok) { fail++; console.log('MISMATCH', JSON.stringify(c), row.policy, row.nowcast, row.lease, row.reserve, row.issue, '\n  js ', got.join(','), '\n  py ', want.join(',')); }
}
console.log(fail ? `${fail} of ${ref.length} blood-group runs differ` : `OK: all ${ref.length} blood-group runs match the Python engine`);
process.exit(fail ? 1 : 0);

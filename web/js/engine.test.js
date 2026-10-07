// Parity test: the browser engine must reproduce the Python engine exactly.
//   node web/js/engine.test.js engine/tests/fixtures/py_reference.json
const fs = require('fs');
const E = require('./engine.js');

const ref = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let fail = 0;
for (const row of ref) {
  const c = row.config;
  const sim = new E.Sim({ N: c.n, L: c.L, rho: c.rho, m: c.m, delay: c.delay, p: c.p, c: c.c, seed: c.seed },
    { policy: row.policy, nowcast: row.nowcast, lease: row.lease, q: 0.85 });
  const t = sim.run();
  const got = [t.waste, t.short, t.sup, t.dem, t.moved, t.conf, t.declined];
  const want = [row.waste, row.short, row.sup, row.dem, row.moved, row.conf, row.declined];
  const ok = got.every((v, k) => v === want[k]) && Math.abs(t.cost - row.cost) < 1e-6 * Math.max(1, row.cost);
  if (!ok) { fail++; console.log('MISMATCH', JSON.stringify(c), row.policy, row.nowcast, row.lease, '\n  js ', got, t.cost, '\n  py ', want, row.cost); }
}
console.log(fail ? `${fail} of ${ref.length} runs differ` : `OK: all ${ref.length} runs match the Python engine`);
process.exit(fail ? 1 : 0);

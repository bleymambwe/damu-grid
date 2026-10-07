// Check (or regenerate) the browser reference numbers used by tests/test_perishnet.py.
//
//   node tools/check_js_parity.js <dashboard.html> <fixture.json>           compare
//   node tools/check_js_parity.js <dashboard.html> <fixture.json> --write   regenerate
//
// The dashboard keeps its simulator between SIM-CORE-START and SIM-CORE-END markers.
const fs = require('fs');
const [html, fixture, flag] = process.argv.slice(2);
const src = fs.readFileSync(html, 'utf8');
const core = src.split('/* SIM-CORE-START')[1].split('/* SIM-CORE-END */')[0].replace(/^[^\n]*\n/, '');
const sim = new Function(core + '\nreturn {params, streams, simulate, POL};')();

const configs = [
  { n: 4, L: 5, rho: 1.1, m: 0.6, d: 0, p: 5, c: 0.3, seed: 7 },
  { n: 4, L: 5, rho: 1.1, m: 0.6, d: 2, p: 5, c: 0.3, seed: 7 },
  { n: 6, L: 8, rho: 1.3, m: 0.9, d: 1, p: 10, c: 0.5, seed: 3 },
  { n: 2, L: 3, rho: 0.9, m: 0.2, d: 0, p: 2, c: 0, seed: 42 },
  { n: 5, L: 12, rho: 1.6, m: 1, d: 6, p: 20, c: 2, seed: 50 },
];
const names = ['none', 'count', 'age'];
const out = configs.map(c => {
  const P = sim.params({ N: c.n, L: c.L, rho: c.rho, m: c.m, delta: c.d, p: c.p, c: c.c, seed: c.seed });
  const st = sim.streams(P);
  const results = {};
  sim.POL.forEach((f, k) => {
    const r = sim.simulate(P, st, f, false);
    results[names[k]] = { waste: r.waste, short: r.short, sup: r.sup, dem: r.dem, moved: r.moved, conf: r.conf, cost: r.cost };
  });
  return { params: c, results };
});

if (flag === '--write') {
  fs.writeFileSync(fixture, JSON.stringify(out, null, 1));
  console.log(`wrote ${out.length} configurations to ${fixture}`);
} else {
  const ref = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  const same = JSON.stringify(ref) === JSON.stringify(out);
  console.log(same ? 'OK: dashboard matches fixture' : 'MISMATCH: dashboard differs from fixture');
  process.exit(same ? 0 : 1);
}

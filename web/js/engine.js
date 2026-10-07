/* Damu Grid engine: a line-for-line port of engine/perishnet (Python).
 * Same seeds give identical results; web/js/engine.test.js checks this
 * against engine/tests/fixtures/py_reference.json.
 *
 * Stock is x[i][r]: units at facility i with r days of shelf life left (r = 1..L).
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- random numbers
  function rngOf(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function pois(l, r) {
    if (l <= 0) return 0;
    if (l < 30) { const e = Math.exp(-l); let k = 0, p = 1; do { k++; p *= r(); } while (p > e); return k - 1; }
    const u = r() || 1e-12, v = r();
    return Math.max(0, Math.floor(l + Math.sqrt(l) * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) + 0.5));
  }
  function pq(l, beta) {
    if (l <= 0) return 0;
    let k = 0, p = Math.exp(-l), c = p;
    while (c < beta && k < 10000) { k++; p *= l / k; c += p; }
    return k;
  }

  // ---------------------------------------------------------------- model
  const BASE = [6, 4, 2.5, 1.5, 1, 0.8];
  function params(cfg) {
    const P = Object.assign({ N: 4, L: 5, rho: 1.1, m: 0.6, delay: 0, p: 5, c: 0.3, h: 1, seed: 7, T: 365 }, cfg);
    P.delays = Array.isArray(P.delay) ? P.delay.slice() : new Array(P.N).fill(P.delay);
    P.lam = BASE.slice(0, P.N);
    let total = 0; for (const l of P.lam) total += l;
    P.sig = P.lam.map((l, i) => P.rho * ((1 - P.m) * l + (i === 0 ? P.m * total : 0)));
    P.beta = P.p / (P.p + P.h);
    P.target = P.lam.map(l => pq(2 * l, P.beta));
    return P;
  }
  function streams(P) {
    const r = rngOf(P.seed * 7919 + 13), S = [], D = [];
    for (let i = 0; i < P.N; i++) { S.push([]); D.push([]); }
    for (let t = 0; t < P.T; t++) for (let i = 0; i < P.N; i++) { S[i].push(pois(P.sig[i], r)); D[i].push(pois(P.lam[i], r)); }
    return { S, D };
  }
  const sum = v => v.reduce((a, b) => a + b, 0);

  // ---------------------------------------------------------------- policies
  function atRisk(v, lam, L) {
    const r = new Array(L + 1).fill(0); let used = 0;
    for (let a = 1; a <= L; a++) { const room = Math.max(0, Math.floor(lam * a) - used); const safe = Math.min(v[a], room); r[a] = v[a] - safe; used += safe; }
    return r;
  }
  function spare(x, inc, lam, j, a) { let s = 0; for (let b = 1; b <= a; b++) s += x[j][b] + inc[j][b]; return Math.floor(lam * a) - s; }

  // Plan entries are [from, to, r, count, reason]; reason is 'rescue' or 'fill'.
  function fill(x, P, order, plan, inc) {
    const N = P.N;
    inc = inc || x.map(v => new Array(v.length).fill(0));
    const sendable = x.map(v => sum(v) - v[1]);
    const held = x.map((v, i) => sum(v) + sum(inc[i]));
    const sur = [], def = [];
    for (let i = 0; i < N; i++) { const g = held[i] - P.target[i]; if (g > 0) sur.push([i, Math.min(g, sendable[i])]); else if (g < 0) def.push([i, -g]); }
    def.sort((a, b) => b[1] - a[1]);
    for (const d of def) {
      let need = d[1];
      sur.sort((a, b) => b[1] - a[1]);
      for (const s of sur) {
        if (need <= 0) break;
        let give = Math.min(need, s[1]); if (give <= 0) continue;
        for (const a of order) {
          if (give <= 0) break;
          const k = Math.min(give, x[s[0]][a]);
          if (k > 0) { plan.push([s[0], d[0], a, k, 'fill']); x[s[0]][a] -= k; inc[d[0]][a] += k; give -= k; need -= k; s[1] -= k; }
        }
      }
    }
    return plan;
  }
  function noTransfer() { return []; }
  function balanceCounts(obs, P) { const x = obs.map(v => v.slice()), ord = []; for (let a = P.L; a >= 2; a--) ord.push(a); return fill(x, P, ord, []); }
  function ageAware(obs, P) {
    const N = P.N, L = P.L, x = obs.map(v => v.slice()), inc = obs.map(v => new Array(v.length).fill(0)), plan = [];
    const risk = x.map((v, i) => atRisk(v, P.lam[i], L));
    for (let a = 2; a <= L; a++) for (let i = 0; i < N; i++) {
      let left = risk[i][a];
      while (left > 0) {
        let bj = -1, bc = 0;
        for (let j = 0; j < N; j++) { if (j === i) continue; const c = spare(x, inc, P.lam[j], j, a); if (c > bc) { bc = c; bj = j; } }
        if (bj < 0) break;
        const k = Math.min(left, bc);
        plan.push([i, bj, a, k, 'rescue']); x[i][a] -= k; inc[bj][a] += k; left -= k;
      }
    }
    const ord = []; for (let a = 2; a <= L; a++) ord.push(a);
    return fill(x, P, ord, plan, inc);
  }

  // ---------------------------------------------------------------- nowcast
  function nowcastUniform(obs, P, plans, q) {
    const L = P.L, N = P.N, x = obs.map(v => v.slice());
    const dem = P.lam.map(l => q === 0.5 ? l : pq(l, q));
    for (const plan of plans) {
      const landing = [];
      for (const [i, j, r, k] of plan) { const moved = Math.min(k, x[i][r]); x[i][r] -= moved; landing.push([j, r - 1, moved]); }
      for (let i = 0; i < N; i++) {
        let d = dem[i];
        for (let r = 1; r <= L; r++) { const take = Math.min(d, x[i][r]); x[i][r] -= take; d -= take; if (d <= 0) break; }
        for (let r = 1; r < L; r++) x[i][r] = x[i][r + 1];
        x[i][L] = P.sig[i];
      }
      for (const [j, r, k] of landing) if (r >= 1) x[j][r] += k;
    }
    return x.map(row => row.map(v => Math.max(0, Math.floor(v))));
  }
  function nowcastPerNode(obs, P, plans, q) {
    const L = P.L, out = [];
    for (let i = 0; i < P.N; i++) {
      const d = P.delays[i], x = obs[i].slice(), dem = q === 0.5 ? P.lam[i] : pq(P.lam[i], q);
      const use = d ? plans.slice(Math.max(0, plans.length - d)) : [];
      for (const plan of use) {
        const landing = [];
        for (const [a, b, r, k] of plan) { if (a === i) x[r] -= Math.min(k, x[r]); if (b === i) landing.push([r - 1, k]); }
        let left = dem;
        for (let r = 1; r <= L; r++) { const take = Math.min(left, x[r]); x[r] -= take; left -= take; if (left <= 0) break; }
        for (let r = 1; r < L; r++) x[r] = x[r + 1];
        x[L] = P.sig[i];
        for (const [r, k] of landing) if (r >= 1) x[r] += k;
      }
      out.push(x.map(v => Math.max(0, Math.floor(v))));
    }
    return out;
  }
  /** Wrap a policy so it decides on a nowcast. `.view` holds the last estimate (for the UI). */
  function makeNowcast(base, q) {
    const MAXKEEP = 12;
    const f = function (obs, P) {
      const dmax = Math.max(...P.delays);
      let x;
      if (dmax === 0) x = obs;
      else if (Math.min(...P.delays) === dmax) x = nowcastUniform(obs, P, f.plans.slice(-dmax), q);
      else x = nowcastPerNode(obs, P, f.plans.slice(-dmax), q);
      f.view = x;
      const plan = base(x, P);
      if (dmax) { f.plans.push(plan); if (f.plans.length > MAXKEEP) f.plans.shift(); }
      return plan;
    };
    f.plans = []; f.view = null;
    return f;
  }

  // ---------------------------------------------------------------- quota leases
  /** Sender-side check: release at-risk units, and others only above the sender's own target. */
  function leaseGrants(plan, inv, P) {
    const N = P.N, L = P.L, left = inv.map(v => v.slice());
    const risk = inv.map((v, i) => atRisk(v, P.lam[i], L));
    const budget = inv.map((v, i) => Math.max(0, sum(v) - sum(risk[i]) - P.target[i]));
    const granted = [], decisions = []; let declined = 0;
    for (const e of plan) {
      const [i, j, r, k] = e;
      const g = Math.min(k, left[i][r]);
      const fromRisk = Math.min(g, risk[i][r]);
      const fromBudget = Math.min(g - fromRisk, budget[i]);
      const ok = fromRisk + fromBudget;
      risk[i][r] -= fromRisk; budget[i] -= fromBudget; left[i][r] -= ok; declined += k - ok;
      decisions.push({ i, j, r, req: k, grant: ok, reason: e[4] || 'fill' });
      if (ok > 0) granted.push([i, j, r, ok, e[4] || 'fill']);
    }
    return { granted, declined, decisions };
  }

  // ---------------------------------------------------------------- simulation
  /**
   * Step-wise simulation. Each day: propose() runs arrivals, supply, the hub's
   * plan and the sender checks; commit(approved) executes, serves demand oldest-first
   * and ages stock. run() does both every day (auto-approve) for batch use.
   */
  class Sim {
    constructor(cfg, opts) {
      opts = opts || {};
      this.P = params(cfg);
      this.st = opts.streams || streams(this.P);
      this.policyName = opts.policy || 'age';
      const base = { none: noTransfer, count: balanceCounts, age: ageAware }[this.policyName];
      this.useNowcast = !!opts.nowcast;
      this.nowcaster = makeNowcast(base, opts.q == null ? 0.85 : opts.q);
      this.base = base;
      this.lease = !!opts.lease;
      const N = this.P.N, L = this.P.L;
      this.inv = []; for (let i = 0; i < N; i++) this.inv.push(new Array(L + 1).fill(0));
      this.transit = []; this.history = []; this.t = 0; this.pending = null; this.days = [];
      this.tot = { waste: 0, short: 0, sup: 0, dem: 0, moved: 0, conf: 0, declined: 0, cost: 0 };
    }
    get done() { return this.t >= this.P.T; }
    propose() {
      if (this.pending || this.done) return this.pending;
      const P = this.P, N = P.N, L = P.L, t = this.t;
      for (const [j, r, k] of this.transit) this.inv[j][r] += k;
      this.transit = [];
      const sup = [];
      for (let i = 0; i < N; i++) { this.inv[i][L] += this.st.S[i][t]; this.tot.sup += this.st.S[i][t]; sup.push(this.st.S[i][t]); }
      const start = this.inv.map(v => v.slice());
      this.history.push(start); if (this.history.length > 13) this.history.shift();
      const h = this.history.length;
      const obs = []; for (let i = 0; i < N; i++) obs.push(this.history[Math.max(0, h - 1 - P.delays[i])][i]);
      let plan;
      if (this.useNowcast) plan = this.nowcaster(obs, P);
      else { plan = this.base(obs, P); this.nowcaster.view = null; }
      const view = this.useNowcast ? this.nowcaster.view : obs.map(v => v.slice());
      let decisions, declined = 0;
      if (this.lease) { const g = leaseGrants(plan, this.inv, P); plan = g.granted; declined = g.declined; decisions = g.decisions; }
      else decisions = plan.map(e => ({ i: e[0], j: e[1], r: e[2], req: e[3], grant: null, reason: e[4] || 'fill' }));
      this.tot.declined += declined;
      this.pending = { t, sup, start, obs: obs.map(v => v.slice()), view, plan, decisions, declined, delays: P.delays.slice() };
      return this.pending;
    }
    commit(approve) {
      if (!this.pending) this.propose();
      const day = this.pending, P = this.P, N = P.N, L = P.L, t = this.t;
      const done = [], exec = []; let moved = 0, conf = 0;
      day.plan.forEach((e, idx) => {
        if (approve && !approve(e, idx)) { exec.push(null); return; }
        const [i, j, r, k] = e, ok = Math.min(k, this.inv[i][r]);
        exec.push(ok);
        conf += k - ok;
        if (ok > 0) { this.inv[i][r] -= ok; this.transit.push([j, r, ok]); done.push([i, j, r, ok, e[4] || 'fill']); moved += ok; }
      });
      if (approve && this.useNowcast && this.nowcaster.plans.length) this.nowcaster.plans[this.nowcaster.plans.length - 1] = done;
      this.tot.conf += conf; this.tot.moved += moved;
      const dem = [], unmet = [], waste = new Array(N).fill(0); let sh = 0;
      for (let i = 0; i < N; i++) {
        let d = this.st.D[i][t]; dem.push(d); this.tot.dem += d;
        for (let r = 1; r <= L && d > 0; r++) { const k = Math.min(d, this.inv[i][r]); this.inv[i][r] -= k; d -= k; }
        unmet.push(d); sh += d;
      }
      this.tot.short += sh;
      let wt = 0;
      for (let i = 0; i < N; i++) { wt += this.inv[i][1]; waste[i] += this.inv[i][1]; for (let r = 1; r < L; r++) this.inv[i][r] = this.inv[i][r + 1]; this.inv[i][L] = 0; }
      this.transit = this.transit.filter(tr => { tr[1] -= 1; if (tr[1] <= 0) { wt += tr[2]; waste[tr[0]] += tr[2]; return false; } return true; });
      this.tot.waste += wt;
      const cost = P.h * wt + P.p * sh + P.c * moved;
      this.tot.cost += cost;
      const rec = Object.assign({}, day, { done, exec, moved, conf, dem, unmet, waste, wt, sh, cost, cum: this.tot.cost, end: this.inv.map(v => v.slice()), transit: this.transit.map(x => x.slice()) });
      this.days.push(rec);
      this.pending = null; this.t++;
      return rec;
    }
    run() { while (!this.done) { this.propose(); this.commit(); } return this.tot; }
  }

  // ---------------------------------------------------------------- blood groups (mirrors perishnet/groups.py)
  const GROUPS = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'];
  const RAW = { 'O-': 3.5, 'O+': 48.25, 'A-': 0.5, 'A+': 23.5, 'B-': 1.0, 'B+': 17.5, 'AB-': 0.0, 'AB+': 5.5 };
  let RAW_TOTAL = 0; for (const g of GROUPS) RAW_TOTAL += RAW[g];
  const KENYA_SHARES = GROUPS.map(g => RAW[g] / RAW_TOTAL);
  const abo = g => ({ O: [], A: ['A'], B: ['B'], AB: ['A', 'B'] })[g.slice(0, -1)];
  function compatible(donor, recipient) {
    const r = abo(recipient);
    return abo(donor).every(a => r.includes(a)) && (donor.endsWith('-') || recipient.endsWith('+'));
  }
  function donorOrder(recipient, shares) {
    const subs = GROUPS.filter(g => g !== recipient && compatible(g, recipient) && g !== 'O-');
    subs.sort((a, b) => (shares[GROUPS.indexOf(b)] - shares[GROUPS.indexOf(a)]) || (GROUPS.indexOf(a) - GROUPS.indexOf(b)));
    const order = [recipient].concat(subs);
    if (recipient !== 'O-') order.push('O-');
    return order.map(g => GROUPS.indexOf(g));
  }
  const ISSUE_ORDER = ['O-', 'A-', 'B-', 'AB-', 'O+', 'A+', 'B+', 'AB+'].map(g => GROUPS.indexOf(g));
  function groupParams(P, share) {
    const lam = P.lam.map(l => l * share), sig = P.sig.map(s => s * share);
    return Object.assign({}, P, { lam, sig, target: lam.map(l => pq(2 * l, P.beta)), delays: P.delays });
  }
  function splitStreams(P, st, shares) {
    const rand = rngOf(P.seed * 104729 + 17), K = shares.length, cum = [];
    let acc = 0; for (const s of shares) { acc += s; cum.push(acc); }
    const split = n => { const out = new Array(K).fill(0); for (let u = 0; u < n; u++) { const x = rand(); let k = 0; while (k < K - 1 && x >= cum[k]) k++; out[k]++; } return out; };
    const ST = [], DT = [];
    for (let i = 0; i < P.N; i++) { ST.push(GROUPS.map(() => new Array(P.T).fill(0))); DT.push(GROUPS.map(() => new Array(P.T).fill(0))); }
    for (let t = 0; t < P.T; t++) for (let i = 0; i < P.N; i++) {
      const s = split(st.S[i][t]), d = split(st.D[i][t]);
      for (let k = 0; k < K; k++) { ST[i][k][t] = s[k]; DT[i][k][t] = d[k]; }
    }
    return { ST, DT };
  }

  /** Step-wise network with blood groups; same propose/commit API as Sim, plus per-group detail. */
  class GroupSim {
    constructor(cfg, opts) {
      opts = opts || {};
      this.P = params(cfg);
      this.st = opts.streams || streams(this.P);
      this.shares = opts.shares || KENYA_SHARES;
      this.issue = opts.issue || 'oldest';
      this.reserveNeg = opts.reserveNeg !== false;
      const sp = splitStreams(this.P, this.st, this.shares);
      this.ST = sp.ST; this.DT = sp.DT;
      this.PG = this.shares.map(s => groupParams(this.P, s));
      this.policyName = opts.policy || 'age';
      this.base = { none: noTransfer, count: balanceCounts, age: ageAware }[this.policyName];
      const q = opts.q == null ? 0.85 : opts.q;
      this.nowcasters = GROUPS.map(() => makeNowcast(this.base, q));
      this.useNowcast = !!opts.nowcast;
      this.lease = !!opts.lease;
      this.orders = GROUPS.map(g => donorOrder(g, this.shares));
      const N = this.P.N, L = this.P.L, K = GROUPS.length;
      this.inv = []; for (let i = 0; i < N; i++) { const node = []; for (let k = 0; k < K; k++) node.push(new Array(L + 1).fill(0)); this.inv.push(node); }
      this.transit = []; this.history = []; this.t = 0; this.pending = null; this.days = [];
      this.tot = { waste: 0, short: 0, sup: 0, dem: 0, moved: 0, conf: 0, declined: 0, cost: 0, subs: 0 };
      this.unmetByGroup = new Array(K).fill(0);
    }
    get done() { return this.t >= this.P.T; }
    agg(typed) { return typed.map(node => { const L = this.P.L, v = new Array(L + 1).fill(0); node.forEach(g => { for (let r = 1; r <= L; r++) v[r] += g[r]; }); return v; }); }
    propose() {
      if (this.pending || this.done) return this.pending;
      const P = this.P, N = P.N, L = P.L, K = GROUPS.length, t = this.t;
      for (const [j, k, r, c] of this.transit) this.inv[j][k][r] += c;
      this.transit = [];
      const sup = new Array(N).fill(0);
      for (let i = 0; i < N; i++) for (let k = 0; k < K; k++) { this.inv[i][k][L] += this.ST[i][k][t]; this.tot.sup += this.ST[i][k][t]; sup[i] += this.ST[i][k][t]; }
      const startG = this.inv.map(node => node.map(v => v.slice()));
      this.history.push(startG); if (this.history.length > 13) this.history.shift();
      const h = this.history.length;
      const obs = []; for (let i = 0; i < N; i++) obs.push(this.history[Math.max(0, h - 1 - P.delays[i])][i]);
      const plan = [], decisions = [], viewG = obs.map(node => node.map(v => v.slice()));
      let declined = 0;
      for (let k = 0; k < K; k++) {
        const ok = obs.map(node => node[k]);
        let pk;
        if (this.useNowcast) { pk = this.nowcasters[k](ok, this.PG[k]); for (let i = 0; i < N; i++) viewG[i][k] = this.nowcasters[k].view[i].slice(); }
        else pk = this.base(ok, this.PG[k]);
        if (this.lease) {
          const g = leaseGrants(pk, this.inv.map(node => node[k]), this.PG[k]);
          declined += g.declined;
          g.decisions.forEach(d => decisions.push(Object.assign(d, { g: k })));
          g.granted.forEach(e => plan.push(e.concat([k])));
        } else {
          pk.forEach(e => { plan.push([e[0], e[1], e[2], e[3], e[4] || 'fill', k]); decisions.push({ i: e[0], j: e[1], r: e[2], req: e[3], grant: null, reason: e[4] || 'fill', g: k }); });
        }
      }
      this.tot.declined += declined;
      this.pending = { t, sup, startG, start: this.agg(startG), obs: this.agg(obs), viewG, view: this.agg(viewG), plan, decisions, declined, delays: P.delays.slice() };
      return this.pending;
    }
    commit(approve) {
      if (!this.pending) this.propose();
      const day = this.pending, P = this.P, N = P.N, L = P.L, K = GROUPS.length, t = this.t;
      const done = [], exec = []; let moved = 0, conf = 0;
      const lastPlan = GROUPS.map(() => []);
      day.plan.forEach((e, idx) => {
        if (approve && !approve(e, idx)) { exec.push(null); return; }
        const [i, j, r, c, why, k] = e, ok = Math.min(c, this.inv[i][k][r]);
        exec.push(ok); conf += c - ok;
        lastPlan[k].push([i, j, r, ok]);
        if (ok > 0) { this.inv[i][k][r] -= ok; this.transit.push([j, k, r, ok]); done.push([i, j, r, ok, why, k]); moved += ok; }
      });
      if (approve && this.useNowcast) this.nowcasters.forEach((f, k) => { if (f.plans.length) f.plans[f.plans.length - 1] = lastPlan[k]; });
      this.tot.conf += conf; this.tot.moved += moved;
      const dem = new Array(N).fill(0), unmet = new Array(N).fill(0), waste = new Array(N).fill(0), subs = [];
      let sh = 0, nsubs = 0;
      for (let i = 0; i < N; i++) {
        for (const k of ISSUE_ORDER) {
          let d = this.DT[i][k][t]; dem[i] += d; this.tot.dem += d;
          let pairs = [];
          for (const donor of this.orders[k]) {
            const last = (this.reserveNeg && GROUPS[donor].endsWith('-') && GROUPS[k].endsWith('+')) ? 1 : L;
            for (let r = 1; r <= last; r++) pairs.push([donor, r]);
          }
          if (this.issue === 'oldest') pairs = pairs.map((p, n) => [p[0], p[1], n]).sort((a, b) => (a[1] - b[1]) || (a[2] - b[2]));
          for (const [donor, r] of pairs) {
            if (d <= 0) break;
            const take = Math.min(d, this.inv[i][donor][r]);
            this.inv[i][donor][r] -= take; d -= take;
            if (donor !== k && take > 0) { nsubs += take; subs.push([i, k, donor, take]); }
          }
          unmet[i] += d; sh += d; this.unmetByGroup[k] += d;
        }
      }
      this.tot.short += sh; this.tot.subs += nsubs;
      let wt = 0;
      for (let i = 0; i < N; i++) for (let k = 0; k < K; k++) {
        wt += this.inv[i][k][1]; waste[i] += this.inv[i][k][1];
        for (let r = 1; r < L; r++) this.inv[i][k][r] = this.inv[i][k][r + 1];
        this.inv[i][k][L] = 0;
      }
      this.transit = this.transit.filter(tr => { tr[2] -= 1; if (tr[2] <= 0) { wt += tr[3]; waste[tr[0]] += tr[3]; return false; } return true; });
      this.tot.waste += wt;
      const cost = P.h * wt + P.p * sh + P.c * moved;
      this.tot.cost += cost;
      const endG = this.inv.map(node => node.map(v => v.slice()));
      const rec = Object.assign({}, day, { done, exec, moved, conf, dem, unmet, waste, wt, sh, cost, cum: this.tot.cost, subs, endG, end: this.agg(endG) });
      this.days.push(rec);
      this.pending = null; this.t++;
      return rec;
    }
    run() { while (!this.done) { this.propose(); this.commit(); } return this.tot; }
  }

  const api = { rngOf, pois, pq, params, streams, atRisk, spare, fill, noTransfer, balanceCounts, ageAware,
    nowcastUniform, nowcastPerNode, makeNowcast, leaseGrants, Sim, BASE,
    GROUPS, KENYA_SHARES, compatible, donorOrder, GroupSim };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DamuEngine = api;
})(typeof self !== 'undefined' ? self : this);

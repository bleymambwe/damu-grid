/* Damu Grid demo UI. All numbers come from engine.js (synthetic data). */
(function () {
  'use strict';
  const E = window.DamuEngine;
  const $ = id => document.getElementById(id);
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Facilities: real towns, illustrative (synthetic) demand rates in platelet units per day.
  const FAC = [
    { name: 'Nairobi', code: 'NBI', role: 'Regional blood transfusion centre · collection hub', lat: -1.2921, lon: 36.8219, lab: 'down' },
    { name: 'Nakuru', code: 'NKR', role: 'County referral hospital', lat: -0.3031, lon: 36.0800, lab: 'right' },
    { name: 'Kisumu', code: 'KSM', role: 'County referral hospital', lat: -0.0917, lon: 34.7680, lab: 'down' },
    { name: 'Eldoret', code: 'ELD', role: 'Teaching and referral hospital', lat: 0.5143, lon: 35.2698, lab: 'up' },
    { name: 'Siaya', code: 'SIA', role: 'County referral hospital', lat: 0.0607, lon: 34.2881, lab: 'left' },
    { name: 'Lodwar', code: 'LDW', role: 'Turkana county referral hospital', lat: 3.1191, lon: 35.5973, lab: 'right' },
  ];
  const BASE_CFG = { N: 6, L: 5, rho: 1.1, m: 0.6, p: 5, c: 0.3, seed: 7, T: 365, delay: [0, 0, 0, 0, 0, 0] };
  const STORIES = [
    { title: 'Normal days', cfg: {}, nowcast: true, lease: true,
      text: 'All six facilities report on time. Platelets that would expire where they sit go to facilities that will use them, and anyone below a two-day safety level is topped up.' },
    { title: 'Siaya and Lodwar go offline', cfg: { delay: [0, 0, 0, 0, 4, 3] }, nowcast: false, lease: false,
      text: 'Siaya reports 4 days late and Lodwar 3, with both protections off. The hub plans on stale counts and asks for units that are already gone.' },
    { title: 'Same outage, protected', cfg: { delay: [0, 0, 0, 0, 4, 3] }, nowcast: true, lease: true,
      text: 'Same outage. The nowcast estimates today’s stock from the last report, and every sender confirms units against its live shelf. Conflicts stay at zero.' },
    { title: 'Scarce supply', cfg: { rho: 0.95, m: 0.9, p: 10, delay: [0, 1, 1, 1, 2, 2] }, nowcast: true, lease: true,
      text: 'Supply falls to 95% of demand and 90% of it is collected in Nairobi, and some links are slow. The engine decides where scarce stock does most good.' },
  ];
  const WARM = 14, DAY_MS = 1700;
  const CATS = [
    { key: 'ok', label: 'Well stocked', col: 'navy' },
    { key: 'low', label: 'Below safety level', col: 'blue' },
    { key: 'crit', label: 'Critically low', col: 'blue-2' },
    { key: 'exp', label: 'Units at risk of expiring', col: 'gold' },
  ];

  // ---------------------------------------------------------------- colours
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const hex = c => { c = c.replace('#', ''); if (c.length === 3) c = c.split('').map(x => x + x).join(''); const n = parseInt(c, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const mix = (a, b, f) => a.map((v, i) => Math.round(v + (b[i] - v) * f));
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a == null ? 1 : a})`;
  let PAL;
  function readPalette() {
    PAL = {};
    ['ink', 'ink-2', 'muted', 'line', 'navy', 'blue', 'blue-2', 'pale', 'gold', 'red', 'dot-land', 'dot-ken', 'life1', 'life2', 'life3', 'card-solid'].forEach(k => PAL[k] = css('--' + k));
    PAL.l1 = hex(PAL.life1); PAL.l2 = hex(PAL.life2); PAL.l3 = hex(PAL.life3);
  }
  function life(r, L) { const f = L <= 1 ? 1 : (r - 1) / (L - 1); return f < .5 ? mix(PAL.l1, PAL.l2, f * 2) : mix(PAL.l2, PAL.l3, (f - .5) * 2); }

  // ---------------------------------------------------------------- state
  let MAP = null, sim, shadow, storyIdx = 0, cur = null, phase = 1, mode = reduce ? 'pause' : 'play', speed = 1, last = 0;
  let awaiting = false, decisions = [], selected = 4, ledger = [], facTot = [];
  const auto = () => $('auto').checked;
  const sumv = v => v.reduce((a, b) => a + b, 0) - v[0];

  function build(cfgOver, nowcast, lease) {
    const cfg = Object.assign({}, BASE_CFG, cfgOver);
    sim = new E.Sim(cfg, { policy: 'age', nowcast, lease, q: 0.85 });
    shadow = new E.Sim(cfg, { policy: 'none', streams: sim.st });
    ledger = []; facTot = FAC.map(() => ({ x: 0, u: 0 }));
    awaiting = false; $('await').hidden = true;
    for (let k = 0; k < WARM; k++) { sim.propose(); shadow.propose(); shadow.commit(); afterDay(sim.commit()); }
    cur = sim.days[sim.days.length - 1]; phase = 1;
    $('l-now').checked = nowcast; $('l-lease').checked = lease;
    refreshAll();
  }
  function setStory(i) {
    storyIdx = i;
    document.querySelectorAll('.chip').forEach((c, k) => c.setAttribute('aria-selected', String(k === i)));
    $('storyline').textContent = STORIES[i].text;
    build(STORIES[i].cfg, STORIES[i].nowcast, STORIES[i].lease);
  }
  function refreshAll() { renderDots(); renderSuggestions(cur); renderSide(); renderLedger(); renderHead(); renderBanner(); if (!$('pane-fac').hidden) renderFacility(); }

  // ---------------------------------------------------------------- day cycle
  function beginDay() {
    if (sim.done) { setMode('pause'); return; }
    const day = sim.propose();
    shadow.propose(); shadow.commit();
    if (!auto() && day.plan.length) {
      awaiting = true; decisions = day.plan.map(() => true);
      cur = Object.assign({ pending: true }, day); phase = 0.14;
      $('await-n').textContent = day.plan.length; $('await').hidden = false;
      renderSuggestions(cur); renderDots(); renderBanner();
      return;
    }
    finishDay();
  }
  function finishDay() {
    const manual = awaiting;
    const rec = sim.commit(manual ? (e, idx) => decisions[idx] : null);
    awaiting = false; $('await').hidden = true;
    cur = rec; phase = manual ? 0.15 : 0;
    afterDay(rec);
    refreshAll();
  }
  function afterDay(rec) {
    const t = rec.t, items = [];
    rec.done.forEach(([i, j, r, k, why]) => items.push(['t', `${FAC[i].name} → ${FAC[j].name}: ${k} unit${k > 1 ? 's' : ''}, ${r} day${r > 1 ? 's' : ''} left (${why === 'rescue' ? 'expiry rescue' : 'top-up'})`]));
    rec.waste.forEach((w, i) => { if (w) { facTot[i].x += w; items.push(['x', `${FAC[i].name}: ${w} unit${w > 1 ? 's' : ''} expired`]); } });
    rec.unmet.forEach((u, i) => { if (u) { facTot[i].u += u; items.push(['u', `${FAC[i].name}: ${u} request${u > 1 ? 's' : ''} unmet`]); } });
    if (rec.declined) items.push(['', `Senders declined ${rec.declined} requested unit${rec.declined > 1 ? 's' : ''} (needed locally)`]);
    if (rec.conf) items.push(['u', `${rec.conf} requested unit${rec.conf > 1 ? 's were' : ' was'} no longer on the shelf (conflict)`]);
    if (!items.length) items.push(['', 'No transfers, no expiries, all requests met']);
    ledger.unshift({ t, items }); if (ledger.length > 120) ledger.pop();
    $('dayno').textContent = t + 1;
  }

  // ---------------------------------------------------------------- facility status
  function stockOf(rec, i) { return rec.pending ? rec.start[i] : rec.end[i]; }
  function status(rec, i) {
    const P = sim.P, v = stockOf(rec, i), tot = sumv(v), risk = E.atRisk(v, P.lam[i], P.L);
    if (risk.slice(2).some(x => x > 0)) return 'exp';
    if (tot >= P.target[i]) return 'ok';
    if (tot >= P.target[i] / 2) return 'low';
    return 'crit';
  }

  // ---------------------------------------------------------------- map
  const cv = $('map'), ctx = cv.getContext('2d');
  let W = 0, H = 0, proj = null, inv = null, dots = [], dotLayer = null, pos = [], step = 11;
  const VIEW = { lon0: 33.3, lon1: 38.9, lat0: -2.6, lat1: 4.65 };
  function resize() {
    const r = cv.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    W = Math.max(280, r.width); H = Math.max(280, r.height);
    cv.width = Math.round(W * d); cv.height = Math.round(H * d); ctx.setTransform(d, 0, 0, d, 0, 0);
    const kx = Math.cos(1 * Math.PI / 180), spanX = (VIEW.lon1 - VIEW.lon0) * kx, spanY = VIEW.lat1 - VIEW.lat0;
    const s = Math.min((W - 30) / spanX, (H - 40) / spanY);
    const ox = (W - spanX * s) / 2, oy = (H - spanY * s) / 2;
    proj = (lon, lat) => [ox + (lon - VIEW.lon0) * kx * s, oy + (VIEW.lat1 - lat) * s];
    inv = (x, y) => [VIEW.lon0 + (x - ox) / (kx * s), VIEW.lat1 - (y - oy) / s];
    proj.scale = s;
    step = Math.max(8, Math.min(13, s / 9.5));
    pos = FAC.map(f => proj(f.lon, f.lat));
    buildDots(); renderDots();
  }
  function inRing(lon, lat, ring) {
    let c = false;
    for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
      const [xa, ya] = ring[a], [xb, yb] = ring[b];
      if ((ya > lat) !== (yb > lat) && lon < (xb - xa) * (lat - ya) / (yb - ya) + xa) c = !c;
    }
    return c;
  }
  function buildDots() {
    dots = [];
    if (!MAP || !proj) return;
    const hgt = step * Math.sqrt(3) / 2, reach = 1.05 * proj.scale;
    for (let row = 0, y = step / 2; y < H; row++, y += hgt) {
      for (let x = (row % 2 ? step : step / 2); x < W; x += step) {
        const [lon, lat] = inv(x, y);
        let country = null;
        for (const c of MAP.countries) { if (c.rings.some(rg => inRing(lon, lat, rg))) { country = c.iso; break; } }
        if (!country) continue;
        if (MAP.lakes.some(l => l.rings.some(rg => inRing(lon, lat, rg)))) continue;
        let fi = -1;
        if (country === 'KEN') {
          let bd = reach;
          pos.forEach(([px, py], i) => { const d = Math.hypot(px - x, py - y) / Math.sqrt(sim ? sim.P.lam[i] / 2 + .6 : 1); if (d < bd) { bd = d; fi = i; } });
        }
        dots.push({ x, y, ken: country === 'KEN', fi });
      }
    }
  }
  function renderDots() {
    if (!proj || !cur) return;
    const d = window.devicePixelRatio || 1;
    dotLayer = document.createElement('canvas'); dotLayer.width = cv.width; dotLayer.height = cv.height;
    const g = dotLayer.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0);
    const cols = FAC.map((f, i) => {
      const st = status(cur, i), c = PAL[CATS.find(k => k.key === st).col];
      return cur.delays[i] > 0 ? rgba(mix(hex(c), hex(PAL['dot-land']), .45)) : c;
    });
    const rad = step * .36;
    const paths = new Map();
    dots.forEach(p => {
      const col = !p.ken ? PAL['dot-land'] : p.fi < 0 ? PAL['dot-ken'] : cols[p.fi];
      if (!paths.has(col)) paths.set(col, new Path2D());
      const pa = paths.get(col); pa.moveTo(p.x + rad, p.y); pa.arc(p.x, p.y, rad, 0, Math.PI * 2);
    });
    paths.forEach((pa, col) => { g.fillStyle = col; g.fill(pa); });
    g.font = '600 11px "DM Sans", sans-serif'; g.textAlign = 'center'; g.fillStyle = PAL.muted;
    [['UGANDA', 33.75, 2.3], ['TANZANIA', 35.6, -2.3], ['ETHIOPIA', 37.9, 4.45], ['L. Victoria', 33.85, -0.7], ['L. Turkana', 36.15, 3.75]].forEach(([t, lon, lat]) => {
      const [x, y] = proj(lon, lat); if (x > 30 && x < W - 30 && y > 14 && y < H - 8) g.fillText(t, x, y); });
  }
  const R = i => (14 + 13 * Math.sqrt(sim.P.lam[i] / sim.P.lam[0])) * Math.max(.75, Math.min(1.25, proj.scale / 100));
  const ease = f => f < .5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function bez(a, b, f) {
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, nx = -(b[1] - a[1]) * .22, ny = (b[0] - a[0]) * .22, cx = mx + nx, cy = my + ny;
    return { x: (1 - f) * (1 - f) * a[0] + 2 * (1 - f) * f * cx + f * f * b[0], y: (1 - f) * (1 - f) * a[1] + 2 * (1 - f) * f * cy + f * f * b[1], cx, cy };
  }
  function draw() {
    if (!proj || !cur) return;
    ctx.clearRect(0, 0, W, H);
    if (dotLayer) ctx.drawImage(dotLayer, 0, 0, W, H);
    const P = sim.P, L = P.L, rec = cur, ph = phase, navy = hex(PAL.navy);
    const moves = rec.pending ? rec.plan : rec.done;
    moves.forEach((e, idx) => {
      const [i, j, r, k, why] = e, a = pos[i], b = pos[j], q = bez(a, b, .5);
      const rejected = rec.pending && !decisions[idx];
      const col = why === 'rescue' ? hex(PAL.gold) : navy;
      ctx.save();
      ctx.strokeStyle = rgba(col, rejected ? .15 : .55); ctx.lineWidth = rejected ? 1 : 1.6 + Math.min(5.5, k * .5); ctx.lineCap = 'round';
      if (rec.pending) ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(q.cx, q.cy, b[0], b[1]); ctx.stroke(); ctx.restore();
      const tip = bez(a, b, .88), tip2 = bez(a, b, .84), ang = Math.atan2(tip.y - tip2.y, tip.x - tip2.x);
      ctx.fillStyle = rgba(col, rejected ? .2 : .9);
      ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.lineTo(tip.x - 9 * Math.cos(ang - .45), tip.y - 9 * Math.sin(ang - .45)); ctx.lineTo(tip.x - 9 * Math.cos(ang + .45), tip.y - 9 * Math.sin(ang + .45)); ctx.fill();
      const lx = q.x * .55 + q.cx * .45, ly = q.y * .55 + q.cy * .45;
      ctx.fillStyle = PAL['card-solid']; ctx.beginPath(); ctx.arc(lx, ly, 10, 0, 7); ctx.fill();
      ctx.font = '700 11px "DM Sans", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = rejected ? PAL.muted : rgba(col);
      ctx.fillText(String(k), lx, ly + .5);
    });
    if (!rec.pending && ph >= .15 && ph < .66) {
      const g = (ph - .15) / .5;
      rec.done.forEach(([i, j, r, k, why]) => {
        const n = Math.min(k, 8), col = why === 'rescue' ? hex(PAL.gold) : navy;
        for (let d = 0; d < n; d++) {
          const f = reduce ? 1 : ease(clamp(g * 1.3 - d * .06, 0, 1)), q = bez(pos[i], pos[j], f);
          ctx.fillStyle = rgba(col); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(q.x, q.y, 4, 0, 7); ctx.fill(); ctx.stroke();
        }
      });
    }
    FAC.forEach((f, i) => {
      const [x, y] = pos[i], rad = R(i), stock = (rec.pending || ph < .62) ? rec.start[i] : rec.end[i], total = sumv(stock), delay = rec.delays[i];
      if (delay > 0) {
        ctx.save(); ctx.strokeStyle = PAL.navy; ctx.globalAlpha = .5; ctx.setLineDash([3, 4]); ctx.lineWidth = 1.4;
        const pulse = reduce ? 0 : Math.sin(performance.now() / 600) * 1.5;
        ctx.beginPath(); ctx.arc(x, y, rad + 9 + delay * 1.6 + pulse, 0, 7); ctx.stroke(); ctx.restore();
      }
      ctx.save(); ctx.shadowColor = 'rgba(15,35,80,.22)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 3;
      ctx.fillStyle = PAL['card-solid']; ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill(); ctx.restore();
      const ringW = Math.max(5, rad * .3);
      if (total > 0) {
        let a0 = -Math.PI / 2;
        for (let r = 1; r <= L; r++) { const k = stock[r]; if (!k) continue; const a1 = a0 + (k / total) * Math.PI * 2;
          ctx.strokeStyle = rgba(life(r, L)); ctx.lineWidth = ringW; ctx.beginPath(); ctx.arc(x, y, rad - ringW / 2 - 1, a0, a1 - .03); ctx.stroke(); a0 = a1; }
      } else { ctx.strokeStyle = PAL.pale; ctx.lineWidth = ringW; ctx.beginPath(); ctx.arc(x, y, rad - ringW / 2 - 1, 0, 7); ctx.stroke(); }
      if (i === selected) { ctx.strokeStyle = PAL.navy; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, rad + 4, 0, 7); ctx.stroke(); }
      ctx.fillStyle = PAL.navy; ctx.font = `700 ${Math.round(rad * .6)}px "DM Sans", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(total), x, y + 1);
      if (!rec.pending && ph >= .55 && rec.unmet[i] > 0) {
        const p2 = reduce ? 1 : 1 + .05 * Math.sin(ph * 40);
        ctx.strokeStyle = PAL.red; ctx.lineWidth = 2.6; ctx.globalAlpha = Math.min(1, (ph - .55) * 5);
        ctx.beginPath(); ctx.arc(x, y, (rad + 6) * p2, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
      }
      const lab = labelPos(f.lab, x, y, rad, delay);
      ctx.textBaseline = 'alphabetic'; ctx.textAlign = lab.align;
      ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(255,255,255,.92)'; ctx.lineWidth = 4;
      ctx.font = '700 13.5px "DM Sans", sans-serif'; ctx.strokeText(f.name, lab.x, lab.y); ctx.fillStyle = PAL.ink; ctx.fillText(f.name, lab.x, lab.y);
      ctx.font = '500 11px "DM Sans", sans-serif'; ctx.fillStyle = PAL['ink-2'];
      let sub = `${P.lam[i]}/day`;
      if (delay > 0) { const seen = rec.view ? sumv(rec.view[i]) : null; sub += ` · data ${delay}d old` + (seen != null ? ` · hub ${sim.useNowcast ? 'est.' : 'sees'} ${seen}` : ''); }
      ctx.strokeText(sub, lab.x, lab.y + 14); ctx.fillText(sub, lab.x, lab.y + 14);
      let ly = lab.y + 28;
      if (!rec.pending && ph >= .55 && rec.unmet[i] > 0) { ctx.fillStyle = PAL.red; ctx.font = '700 11px "DM Sans", sans-serif'; ctx.strokeText(`${rec.unmet[i]} unmet`, lab.x, ly); ctx.fillText(`${rec.unmet[i]} unmet`, lab.x, ly); ly += 13; }
      if (!rec.pending && ph >= .72 && rec.waste[i] > 0) {
        ctx.globalAlpha = reduce ? 1 : 1 - (ph - .72) * .8; ctx.fillStyle = '#a9781a'; ctx.font = '700 11px "DM Sans", sans-serif';
        ctx.strokeText(`✕ ${rec.waste[i]} expired`, lab.x, ly); ctx.fillText(`✕ ${rec.waste[i]} expired`, lab.x, ly); ctx.globalAlpha = 1;
      }
    });
  }
  function labelPos(dir, x, y, rad, delay) {
    const g = rad + 10 + (delay ? 6 + delay * 1.6 : 0);
    if (dir === 'left') return { x: x - g, y: y - 6, align: 'right' };
    if (dir === 'right') return { x: x + g, y: y - 6, align: 'left' };
    if (dir === 'up') return { x, y: y - g - 16, align: 'center' };
    return { x, y: y + g + 8, align: 'center' };
  }
  cv.addEventListener('click', ev => {
    const r = cv.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
    let best = -1, bd = 1e9;
    pos.forEach(([x, y], i) => { const d = Math.hypot(mx - x, my - y); if (d < bd) { bd = d; best = i; } });
    if (best >= 0 && bd < R(best) + 26) { selected = best; showTab('fac'); renderFacility(); }
  });

  // ---------------------------------------------------------------- panels
  function reasonText(d) {
    const P = sim.P, a = FAC[d.i].name, b = FAC[d.j].name;
    return d.reason === 'rescue'
      ? `${a} uses about ${P.lam[d.i]} units a day, so these would expire on its shelf. ${b} can use them in time.`
      : `${b} is below its two-day safety level of ${P.target[d.j]} units. ${a} holds more than it needs.`;
  }
  function renderSuggestions(rec) {
    const list = $('sugg'), ds = rec.decisions || [];
    $('sugg-count').textContent = ds.filter(d => d.grant == null || d.grant > 0).length;
    if (!ds.length) { list.innerHTML = '<li class="empty">No transfers needed today. Every facility is within its safety level and nothing is at risk of expiring.</li>'; return; }
    const mx = Math.max(...ds.map(d => d.req));
    let pi = -1;
    list.innerHTML = ds.map(d => {
      const inPlan = d.grant == null || d.grant > 0; if (inPlan) pi++;
      const idx = pi, units = d.grant == null ? d.req : d.grant;
      let lease;
      if (d.grant == null) lease = '<span class="lease part">Not confirmed with the sender (quota leases off)</span>';
      else if (d.grant === d.req) lease = `<span class="lease ok">Sender confirmed all ${d.req} on its live shelf</span>`;
      else if (d.grant === 0) lease = `<span class="lease part">Sender declined: it needs these ${d.req} units itself</span>`;
      else lease = `<span class="lease part">Sender confirmed ${d.grant} of ${d.req}; keeps the rest</span>`;
      let status = '';
      if (!rec.pending && inPlan && rec.exec) {
        const ex = rec.exec[idx];
        if (ex === null) status = ' · <span class="lease">Rejected</span>';
        else if (ex < units) status = ` · <span class="lease bad">only ${ex} of ${units} were still on the shelf</span>`;
      }
      const act = rec.pending && inPlan
        ? `<div class="act"><button class="btn small" data-a="${idx}">${decisions[idx] ? 'Approved' : 'Approve'}</button><button class="btn small no" data-r="${idx}">${decisions[idx] ? 'Reject' : 'Rejected'}</button></div>` : '';
      return `<li class="item"><span class="badge ${d.reason}">${FAC[d.i].code}</span><div>
        <div class="t">${FAC[d.i].name} → ${FAC[d.j].name}<span>${units} unit${units === 1 ? '' : 's'}</span></div>
        <div class="bar"><i class="${d.reason}" style="width:${100 * units / mx}%"></i></div>
        <p>${reasonText(d)}</p>
        <div class="meta">${d.reason === 'rescue' ? 'Expiry rescue' : 'Top-up'} · ${d.r} day${d.r > 1 ? 's' : ''} of shelf life left · ${lease}${status}</div>${act}</div></li>`;
    }).join('');
  }
  $('sugg').addEventListener('click', e => {
    const a = e.target.closest('[data-a]'), r = e.target.closest('[data-r]');
    if (!awaiting) return;
    if (a) decisions[+a.dataset.a] = true;
    if (r) decisions[+r.dataset.r] = false;
    renderSuggestions(cur);
  });
  $('apply').addEventListener('click', () => { if (awaiting) finishDay(); });

  function saved() { const a = sim.tot, b = shadow.tot; return (b.waste + b.short) - (a.waste + a.short); }
  function renderSide() {
    const a = sim.tot, b = shadow.tot, s = saved();
    $('saved').textContent = s;
    $('saved-sub').textContent = `fewer expired units and unmet requests than with no coordination, over ${sim.t} days`;
    $('compare').innerHTML = `<span></span><span class="h">Damu Grid</span><span class="h">None</span>
      <span>Units expired</span><span class="v us">${a.waste}</span><span class="v them">${b.waste}</span>
      <span>Requests unmet</span><span class="v us">${a.short}</span><span class="v them">${b.short}</span>
      <span>Units moved</span><span class="v us">${a.moved}</span><span class="v them">0</span>
      <span>Conflicts</span><span class="v us" style="${a.conf ? 'color:var(--red)' : ''}">${a.conf}</span><span class="v them">0</span>`;
    drawSpark();
  }
  function renderHead() {
    const s = saved();
    $('headline').textContent = s >= 0 ? `Coordination has saved ${s} platelet units in ${sim.t} days.` : `Coordination is ${-s} units behind after ${sim.t} days.`;
    $('subline').textContent = `6 facilities · platelets, 5-day shelf life · ${STORIES[storyIdx].title} · day ${sim.t} of ${sim.P.T}`;
    const counts = { ok: 0, low: 0, crit: 0, exp: 0 };
    FAC.forEach((f, i) => counts[status(cur, i)]++);
    const late = cur.delays.filter(d => d > 0).length;
    $('legend').innerHTML = CATS.map(c => `<li><i style="background:var(--${c.col})"></i>${c.label}<span>${counts[c.key]}</span></li>`).join('')
      + `<li><i style="background:transparent;border:1.5px dashed var(--navy)"></i>Data arriving late<span>${late}</span></li>`;
  }
  function renderBanner() {
    const rec = cur, late = FAC.map((f, i) => [f.name, rec.delays[i], i]).filter(x => x[1] > 0);
    let title, sub, act, fn;
    const rescue = (rec.pending ? rec.plan : rec.done).filter(e => e[4] === 'rescue');
    if (rec.conf > 0) {
      title = `${rec.conf} requested unit${rec.conf > 1 ? 's were' : ' was'} no longer on the shelf today.`;
      sub = 'The hub planned on stale counts. Nowcast and quota leases prevent this.';
      act = 'Turn protections on'; fn = () => { $('l-now').checked = true; $('l-lease').checked = true; sim.useNowcast = true; sim.lease = true; renderBanner(); };
    } else if (late.length) {
      const [nm, d, i] = late.sort((a, b) => b[1] - a[1])[0];
      title = `${late.map(x => x[0]).join(' and ')} ${late.length > 1 ? 'are' : 'is'} reporting late (up to ${d} days).`;
      sub = sim.useNowcast ? 'The hub is estimating their stock from the last report plus expected usage.' : 'The hub is planning on stale counts. Expect conflicts.';
      act = `Open ${nm}`; fn = () => { selected = i; showTab('fac'); };
    } else if (rescue.length) {
      const k = rescue.reduce((a, e) => a + e[3], 0), from = [...new Set(rescue.map(e => FAC[e[0]].name))].join(', ');
      title = `${k} unit${k > 1 ? 's' : ''} would have expired at ${from}. ${rescue.length} transfer${rescue.length > 1 ? 's' : ''} rescue${rescue.length > 1 ? '' : 's'} them.`;
      sub = 'Each unit goes where demand will use it before its shelf life runs out.';
      act = 'Show suggestions'; fn = () => showTab('sugg');
    } else {
      const short = FAC.map((f, i) => [f.name, status(rec, i)]).filter(x => x[1] === 'crit' || x[1] === 'low');
      title = short.length ? `${short.map(x => x[0]).join(', ')} ${short.length > 1 ? 'are' : 'is'} below the two-day safety level.` : 'All six facilities are within their safety level today.';
      sub = short.length ? 'Top-ups are suggested from facilities holding more than they need.' : 'No units are at risk of expiring.';
      act = 'Open ledger'; fn = () => showTab('log');
    }
    $('b-title').textContent = title; $('b-sub').textContent = sub; $('b-act').textContent = act + ' ↗'; $('b-act').onclick = fn;
  }
  function renderLedger() {
    $('ledger').innerHTML = ledger.slice(0, 60).map(d => d.items.map(([c, s]) => `<li class="${c}"><b>Day ${d.t + 1}</b>${s}</li>`).join('')).join('');
  }
  function renderFacility() {
    const i = selected, f = FAC[i], P = sim.P, rec = cur;
    if (!rec) return;
    const stock = stockOf(rec, i), view = rec.view ? rec.view[i] : null, d = P.delays[i];
    const mx = Math.max(1, ...stock.slice(1), ...(view ? view.slice(1) : [0]));
    let bars = '';
    for (let r = P.L; r >= 1; r--) {
      const c = rgba(life(r, P.L));
      bars += `<div class="row"><span>${r} day${r > 1 ? 's' : ''}</span><div class="track"><div class="b" style="width:${100 * stock[r] / mx}%;background:${c}"></div>${view ? `<div class="b view" style="width:${100 * view[r] / mx}%;color:${c}"></div>` : ''}</div><span>${stock[r]}${view && view[r] !== stock[r] ? '/' + view[r] : ''}</span></div>`;
    }
    $('pane-fac').innerHTML = `<div class="fac"><h3>${f.name}</h3><p class="subt">${f.role}</p>
      <div class="eyebrow" style="margin-bottom:6px">Data link</div>
      <div class="seg" role="group" aria-label="Data link for ${f.name}">${[0, 1, 2, 4].map(v => `<button data-d="${v}" aria-pressed="${d === v}">${v ? v + ' days late' : 'Live'}</button>`).join('')}</div>
      <div class="stats"><div><b>${P.lam[i]}</b><span>units/day demand</span></div><div><b>${P.target[i]}</b><span>two-day safety level</span></div><div><b>${d ? d + ' d' : 'live'}</b><span>age of hub’s data</span></div></div>
      <div class="eyebrow">Stock by shelf life left</div>
      <div class="bars">${bars}</div>
      <div class="keyline"><span>solid = actual shelf</span>${view ? `<span>striped = what the hub ${sim.useNowcast ? 'estimates' : 'sees'}</span>` : ''}</div>
      <div class="stats"><div><b>${rec.dem ? rec.dem[i] : '–'}</b><span>requests today</span></div><div><b style="color:var(--red)">${facTot[i].u}</b><span>unmet so far</span></div><div><b style="color:#a9781a">${facTot[i].x}</b><span>expired so far</span></div></div></div>`;
  }
  $('pane-fac').addEventListener('click', e => {
    const b = e.target.closest('[data-d]'); if (!b) return;
    sim.P.delays[selected] = +b.dataset.d;
    document.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-selected', 'false'));
    $('storyline').textContent = `Custom: you changed ${FAC[selected].name}’s data link. It applies from the next day.`;
    renderFacility();
  });
  function showTab(k) {
    ['sugg', 'fac', 'log'].forEach(n => { $('tab-' + n).setAttribute('aria-selected', String(n === k)); $('pane-' + n).hidden = n !== k; });
    if (k === 'fac') renderFacility(); if (k === 'log') renderLedger();
  }
  ['sugg', 'fac', 'log'].forEach(n => $('tab-' + n).addEventListener('click', () => showTab(n)));

  function drawSpark() {
    const c = $('spark'), d = window.devicePixelRatio || 1, w = c.clientWidth || 300, h = 54;
    c.width = w * d; c.height = h * d; const g = c.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h);
    const a = sim.days.map(x => x.cum), b = shadow.days.map(x => x.cum), n = Math.max(a.length, 2), mx = Math.max(1, ...b, ...a);
    const line = (arr, col, fill) => { g.beginPath(); arr.forEach((v, k) => { const x = 2 + (w - 4) * k / (n - 1), y = h - 14 - (h - 20) * v / mx; k ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.strokeStyle = col; g.lineWidth = 2; g.stroke(); if (fill) { g.lineTo(2 + (w - 4) * (arr.length - 1) / (n - 1), h - 14); g.lineTo(2, h - 14); g.fillStyle = fill; g.fill(); } };
    line(b, PAL['blue-2']); line(a, PAL.navy, rgba(hex(PAL.navy), .08));
    g.font = '500 10.5px "DM Sans", sans-serif'; g.fillStyle = PAL.muted; g.fillText('Cumulative cost · light = no coordination', 2, h - 2);
  }

  // ---------------------------------------------------------------- loop & controls
  function setMode(m) { mode = m; $('play').textContent = m === 'play' ? 'Pause' : 'Play'; }
  function frame(ts) {
    const dt = last ? Math.min(400, ts - last) : 16; last = ts;
    if ((mode === 'play' || mode === 'step') && !awaiting) {
      phase += dt / (DAY_MS / speed) * (reduce ? 4 : 1);
      if (phase >= 1) { if (mode === 'step') { phase = 1; setMode('pause'); } else { phase = 0; beginDay(); } }
    }
    draw();
    requestAnimationFrame(frame);
  }
  $('play').addEventListener('click', () => setMode(mode === 'play' ? 'pause' : 'play'));
  $('step').addEventListener('click', () => { if (awaiting) { finishDay(); mode = 'step'; return; } beginDay(); if (!awaiting) { phase = 0; mode = 'step'; } });
  $('speed').addEventListener('change', e => speed = +e.target.value);
  $('reset').addEventListener('click', () => setStory(storyIdx));
  $('l-now').addEventListener('change', e => { sim.useNowcast = e.target.checked; renderBanner(); });
  $('l-lease').addEventListener('change', e => { sim.lease = e.target.checked; renderBanner(); });
  $('auto').addEventListener('change', () => { if (auto() && awaiting) finishDay(); });
  document.addEventListener('keydown', e => {
    if (e.target.closest('input,select,textarea,button')) return;
    if (e.code === 'Space') { e.preventDefault(); $('play').click(); }
    if (e.code === 'ArrowRight') { e.preventDefault(); $('step').click(); }
  });
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { resize(); drawSpark(); }, 120); });

  // ---------------------------------------------------------------- boot
  readPalette();
  $('story').innerHTML = STORIES.map((s, i) => `<button class="chip" role="tab" aria-selected="false"><b>${i + 1}</b>${s.title}</button>`).join('');
  document.querySelectorAll('.chip').forEach((c, i) => c.addEventListener('click', () => setStory(i)));
  setStory(0);
  setMode(mode);
  resize();
  fetch('data/kenya_map.json').then(r => r.json()).then(m => { MAP = m; resize(); }).catch(() => {});
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { renderDots(); });
  requestAnimationFrame(frame);
})();

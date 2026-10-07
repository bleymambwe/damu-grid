/* Damu Grid demo UI. All numbers come from engine.js (synthetic data). */
(function () {
  'use strict';
  const E = window.DamuEngine;
  const $ = id => document.getElementById(id);
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Facilities: real towns, illustrative (synthetic) demand rates in platelet units per day.
  const FAC = [
    { name: 'Nairobi', role: 'Regional blood transfusion centre · collection hub', lat: -1.2921, lon: 36.8219, lab: 'down' },
    { name: 'Nakuru', role: 'County referral hospital', lat: -0.3031, lon: 36.0800, lab: 'right' },
    { name: 'Kisumu', role: 'County referral hospital', lat: -0.0917, lon: 34.7680, lab: 'down' },
    { name: 'Eldoret', role: 'Teaching and referral hospital', lat: 0.5143, lon: 35.2698, lab: 'up' },
    { name: 'Siaya', role: 'County referral hospital', lat: 0.0607, lon: 34.2881, lab: 'left' },
    { name: 'Lodwar', role: 'Turkana county referral hospital', lat: 3.1191, lon: 35.5973, lab: 'right' },
  ];
  const BASE_CFG = { N: 6, L: 5, rho: 1.1, m: 0.6, p: 5, c: 0.3, seed: 7, T: 365, delay: [0, 0, 0, 0, 0, 0] };
  const STORIES = [
    { title: 'Normal days', cfg: {}, nowcast: true, lease: true,
      text: 'All six facilities report on time. The engine sends platelets that would expire where they sit to facilities that will use them, and tops up anyone below a two-day safety level. The bar at the bottom compares the same days with no coordination.' },
    { title: 'Siaya and Lodwar go offline', cfg: { delay: [0, 0, 0, 0, 4, 3] }, nowcast: false, lease: false,
      text: 'Siaya’s reports now arrive 4 days late and Lodwar’s 3 days late, and both protections are off. The hub plans on stale counts and asks for units that are already used or expired. Watch the conflicts count climb.' },
    { title: 'Same outage, protected', cfg: { delay: [0, 0, 0, 0, 4, 3] }, nowcast: true, lease: true,
      text: 'Same outage. The nowcast estimates today’s stock from the last report plus expected usage, and every sending facility confirms units against its own live shelf before anything moves. Conflicts stay at zero.' },
    { title: 'Scarce supply', cfg: { rho: 0.95, m: 0.9, p: 10, delay: [0, 1, 1, 1, 2, 2] }, nowcast: true, lease: true,
      text: 'Supply drops to 95% of demand and 90% of it is collected in Nairobi; links are slow. Every unit now matters, and a shortage counts double. The engine decides where the scarce stock does most good.' },
  ];
  const WARM = 14, DAY_MS = 1700;

  // ---------------------------------------------------------------- colours
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const hex = c => { c = c.replace('#', ''); if (c.length === 3) c = c.split('').map(x => x + x).join(''); const n = parseInt(c, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const mix = (a, b, f) => a.map((v, i) => Math.round(v + (b[i] - v) * f));
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a == null ? 1 : a})`;
  let PAL;
  function readPalette() {
    PAL = {};
    ['bg', 'panel', 'panel-2', 'ink', 'ink-2', 'muted', 'line', 'accent', 'life1', 'life2', 'life3', 'unmet', 'expired', 'land', 'land-ken', 'border-ken', 'water'].forEach(k => PAL[k] = css('--' + k));
    PAL.l1 = hex(PAL.life1); PAL.l2 = hex(PAL.life2); PAL.l3 = hex(PAL.life3);
  }
  function life(r, L) { const f = L <= 1 ? 1 : (r - 1) / (L - 1); return f < .5 ? mix(PAL.l1, PAL.l2, f * 2) : mix(PAL.l2, PAL.l3, (f - .5) * 2); }

  // ---------------------------------------------------------------- state
  let MAP = null, sim, shadow, storyIdx = 0, cur = null, phase = 1, mode = reduce ? 'pause' : 'play', speed = 1, last = 0;
  let awaiting = false, decisions = [], selected = 4, ledger = [], facTot = [];
  const auto = () => $('auto').checked;

  function build(cfgOver, nowcast, lease) {
    const cfg = Object.assign({}, BASE_CFG, cfgOver);
    sim = new E.Sim(cfg, { policy: 'age', nowcast, lease, q: 0.85 });
    shadow = new E.Sim(cfg, { policy: 'none', streams: sim.st });
    ledger = []; facTot = FAC.map(() => ({ x: 0, u: 0 }));
    awaiting = false; $('await').hidden = true;
    for (let k = 0; k < WARM; k++) { sim.propose(); shadow.propose(); shadow.commit(); afterDay(sim.commit(), true); }
    cur = sim.days[sim.days.length - 1]; phase = 1;
    $('l-now').checked = nowcast; $('l-lease').checked = lease;
    renderSuggestions(cur); renderCompare(); renderLedger(); renderFacility(); drawSpark();
  }
  function setStory(i) {
    storyIdx = i;
    document.querySelectorAll('.chip').forEach((c, k) => c.setAttribute('aria-selected', String(k === i)));
    $('storyline').textContent = STORIES[i].text;
    build(STORIES[i].cfg, STORIES[i].nowcast, STORIES[i].lease);
  }

  // ---------------------------------------------------------------- day cycle
  function beginDay() {
    if (sim.done) { setMode('pause'); return; }
    const day = sim.propose();
    shadow.propose(); shadow.commit();
    if (!auto() && day.plan.length) {
      awaiting = true; decisions = day.plan.map(() => true);
      cur = Object.assign({ pending: true }, day); phase = 0.14;
      $('await-n').textContent = day.plan.length; $('await').hidden = false;
      renderSuggestions(cur);
      return;
    }
    finishDay();
  }
  function finishDay() {
    const manual = awaiting;
    const rec = sim.commit(manual ? (e, idx) => decisions[idx] : null);
    awaiting = false; $('await').hidden = true;
    cur = rec; phase = manual ? 0.15 : 0;
    afterDay(rec, false);
    renderSuggestions(rec); renderCompare(); renderLedger(); drawSpark();
    if (!$('pane-fac').hidden) renderFacility();
  }
  function afterDay(rec, silent) {
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

  // ---------------------------------------------------------------- map
  const cv = $('map'), ctx = cv.getContext('2d');
  let W = 0, H = 0, proj = null, baseCanvas = null, pos = [];
  const VIEW = { lon0: 33.3, lon1: 38.9, lat0: -2.5, lat1: 4.6 };
  function resize() {
    const r = cv.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    W = Math.max(300, r.width); H = Math.max(300, r.height);
    cv.width = Math.round(W * d); cv.height = Math.round(H * d); ctx.setTransform(d, 0, 0, d, 0, 0);
    const kx = Math.cos(1 * Math.PI / 180), spanX = (VIEW.lon1 - VIEW.lon0) * kx, spanY = VIEW.lat1 - VIEW.lat0;
    const s = Math.min((W - 40) / spanX, (H - 60) / spanY);
    const ox = (W - spanX * s) / 2, oy = (H - spanY * s) / 2 + 6;
    proj = (lon, lat) => [ox + (lon - VIEW.lon0) * kx * s, oy + (VIEW.lat1 - lat) * s];
    proj.scale = s;
    pos = FAC.map(f => proj(f.lon, f.lat));
    drawBase();
  }
  function drawBase() {
    if (!MAP || !proj) return;
    const d = window.devicePixelRatio || 1;
    baseCanvas = document.createElement('canvas'); baseCanvas.width = cv.width; baseCanvas.height = cv.height;
    const b = baseCanvas.getContext('2d'); b.setTransform(d, 0, 0, d, 0, 0);
    b.fillStyle = PAL.water; b.fillRect(0, 0, W, H);
    const path = ring => { ring.forEach(([lon, lat], k) => { const [x, y] = proj(lon, lat); k ? b.lineTo(x, y) : b.moveTo(x, y); }); b.closePath(); };
    MAP.countries.forEach(c => {
      b.beginPath(); c.rings.forEach(path);
      b.fillStyle = c.iso === 'KEN' ? PAL['land-ken'] : PAL.land; b.fill();
      b.strokeStyle = c.iso === 'KEN' ? PAL['border-ken'] : PAL.line; b.lineWidth = c.iso === 'KEN' ? 1.4 : 1; b.stroke();
    });
    MAP.lakes.forEach(l => { b.beginPath(); l.rings.forEach(path); b.fillStyle = PAL.water; b.fill(); b.strokeStyle = PAL.line; b.lineWidth = .8; b.stroke(); });
    b.font = '600 11px "IBM Plex Mono", monospace'; b.textAlign = 'center'; b.fillStyle = PAL.muted;
    [['K E N Y A', 37.9, 1.6], ['UGANDA', 33.75, 2.4], ['TANZANIA', 35.6, -2.25], ['ETHIOPIA', 37.9, 4.4], ['L. Victoria', 33.8, -0.75], ['L. Turkana', 36.25, 3.75]].forEach(([t, lon, lat]) => {
      const [x, y] = proj(lon, lat); if (x > 30 && x < W - 30 && y > 20 && y < H - 10) b.fillText(t, x, y); });
  }
  const R = i => (15 + 15 * Math.sqrt(sim.P.lam[i] / sim.P.lam[0])) * Math.max(.7, Math.min(1.3, proj.scale / 110));
  const ease = f => f < .5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function bez(a, b, f) {
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, nx = -(b[1] - a[1]) * .22, ny = (b[0] - a[0]) * .22, cx = mx + nx, cy = my + ny;
    return { x: (1 - f) * (1 - f) * a[0] + 2 * (1 - f) * f * cx + f * f * b[0], y: (1 - f) * (1 - f) * a[1] + 2 * (1 - f) * f * cy + f * f * b[1], cx, cy };
  }
  function draw() {
    if (!proj || !cur) return;
    ctx.clearRect(0, 0, W, H);
    if (baseCanvas) ctx.drawImage(baseCanvas, 0, 0, W, H);
    const P = sim.P, L = P.L, rec = cur, ph = phase;
    const moves = rec.pending ? rec.plan : rec.done;
    // arcs
    moves.forEach((e, idx) => {
      const [i, j, r, k] = e, a = pos[i], b = pos[j], q = bez(a, b, .5);
      const rejected = rec.pending && !decisions[idx];
      ctx.save();
      ctx.strokeStyle = rgba(life(Math.max(1, r - 1), L), rejected ? .15 : rec.pending ? .55 : .5);
      ctx.lineWidth = rejected ? 1 : 1.5 + Math.min(6, k * .55);
      if (rec.pending) ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(q.cx, q.cy, b[0], b[1]); ctx.stroke();
      ctx.restore();
      const tip = bez(a, b, .9), tip2 = bez(a, b, .86);
      const ang = Math.atan2(tip.y - tip2.y, tip.x - tip2.x);
      ctx.fillStyle = rgba(life(Math.max(1, r - 1), L), rejected ? .2 : .8);
      ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.lineTo(tip.x - 8 * Math.cos(ang - .45), tip.y - 8 * Math.sin(ang - .45)); ctx.lineTo(tip.x - 8 * Math.cos(ang + .45), tip.y - 8 * Math.sin(ang + .45)); ctx.fill();
      ctx.font = '600 11px "IBM Plex Mono", monospace'; ctx.textAlign = 'center'; ctx.fillStyle = rejected ? PAL.muted : PAL.ink;
      ctx.fillText((rec.pending ? '? ' : '') + k, q.x * .55 + q.cx * .45, q.y * .55 + q.cy * .45 - 6);
    });
    // units in transit
    if (!rec.pending && ph >= .15 && ph < .66) {
      const g = (ph - .15) / .5;
      rec.done.forEach(([i, j, r, k]) => {
        const n = Math.min(k, 8);
        for (let d = 0; d < n; d++) {
          const f = reduce ? 1 : ease(clamp(g * 1.3 - d * .06, 0, 1)); const q = bez(pos[i], pos[j], f);
          ctx.fillStyle = rgba(life(Math.max(1, r - 1), L)); ctx.strokeStyle = PAL.bg; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(q.x, q.y, 3.6, 0, 7); ctx.fill(); ctx.stroke();
        }
      });
    }
    // facilities
    FAC.forEach((f, i) => {
      const [x, y] = pos[i], rad = R(i);
      const stock = (rec.pending || ph < .62) ? rec.start[i] : rec.end[i];
      const total = stock.reduce((a, b) => a + b, 0) - stock[0];
      const delay = rec.delays[i];
      // stale halo
      if (delay > 0) {
        ctx.save(); ctx.strokeStyle = PAL.muted; ctx.setLineDash([3, 4]); ctx.lineWidth = 1.3;
        const pulse = reduce ? 0 : Math.sin(performance.now() / 600) * 1.5;
        ctx.beginPath(); ctx.arc(x, y, rad + 10 + delay * 1.6 + pulse, 0, 7); ctx.stroke(); ctx.restore();
      }
      // body
      ctx.fillStyle = PAL.panel; ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
      // freshness ring
      const ringW = Math.max(5, rad * .32);
      if (total > 0) {
        let a0 = -Math.PI / 2;
        for (let r = 1; r <= L; r++) {
          const k = stock[r]; if (!k) continue;
          const a1 = a0 + (k / total) * Math.PI * 2;
          ctx.strokeStyle = rgba(life(r, L)); ctx.lineWidth = ringW;
          ctx.beginPath(); ctx.arc(x, y, rad - ringW / 2, a0, a1 - .02); ctx.stroke(); a0 = a1;
        }
      } else { ctx.strokeStyle = PAL.line; ctx.lineWidth = ringW; ctx.beginPath(); ctx.arc(x, y, rad - ringW / 2, 0, 7); ctx.stroke(); }
      if (i === selected) { ctx.strokeStyle = PAL.accent; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, rad + 4, 0, 7); ctx.stroke(); }
      ctx.fillStyle = PAL.ink; ctx.font = `700 ${Math.round(rad * .62)}px "Archivo", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(total), x, y + 1);
      // unmet
      if (!rec.pending && ph >= .55 && rec.unmet[i] > 0) {
        const p2 = reduce ? 1 : 1 + .06 * Math.sin(ph * 40);
        ctx.strokeStyle = PAL.unmet; ctx.lineWidth = 2.6; ctx.globalAlpha = Math.min(1, (ph - .55) * 5);
        ctx.beginPath(); ctx.arc(x, y, (rad + 6) * p2, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
      }
      // labels
      const lab = labelPos(f.lab, x, y, rad, delay);
      ctx.textBaseline = 'alphabetic'; ctx.textAlign = lab.align;
      ctx.font = '600 13px "IBM Plex Sans", sans-serif'; ctx.fillStyle = PAL.ink; ctx.fillText(f.name, lab.x, lab.y);
      ctx.font = '500 10.5px "IBM Plex Mono", monospace'; ctx.fillStyle = PAL['ink-2'];
      let sub = `${sim.P.lam[i]}/day`;
      if (delay > 0) {
        const seen = rec.view ? rec.view[i].reduce((a, b) => a + b, 0) - rec.view[i][0] : null;
        sub += ` · data ${delay}d old` + (seen != null ? ` · hub ${sim.useNowcast ? 'est.' : 'sees'} ${seen}` : '');
      }
      ctx.fillText(sub, lab.x, lab.y + 14);
      let ly = lab.y + 28;
      if (!rec.pending && ph >= .55 && rec.unmet[i] > 0) { ctx.fillStyle = PAL.unmet; ctx.fillText(`${rec.unmet[i]} unmet`, lab.x, ly); ly += 13; }
      if (!rec.pending && ph >= .72 && rec.waste[i] > 0) {
        ctx.globalAlpha = reduce ? 1 : 1 - (ph - .72) * .8; ctx.fillStyle = PAL.expired; ctx.font = '700 11px "IBM Plex Mono", monospace';
        ctx.fillText(`✕ ${rec.waste[i]} expired`, lab.x, ly); ctx.globalAlpha = 1;
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
    if (best >= 0 && bd < R(best) + 26) { selected = best; showTab('fac'); renderFacility(); draw(); }
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
    let pi = -1;
    list.innerHTML = ds.map(d => {
      const inPlan = d.grant == null || d.grant > 0; if (inPlan) pi++;
      const idx = pi, units = d.grant == null ? d.req : d.grant;
      let lease;
      if (d.grant == null) lease = '<span class="lease off">Not confirmed with the sender (quota leases off)</span>';
      else if (d.grant === d.req) lease = `<span class="lease ok">Sender confirmed all ${d.req} against its live shelf</span>`;
      else if (d.grant === 0) lease = `<span class="lease part">Sender declined: it needs these ${d.req} units itself</span>`;
      else lease = `<span class="lease part">Sender confirmed ${d.grant} of ${d.req}; keeps the rest for local demand</span>`;
      let status = '';
      if (!rec.pending && inPlan && rec.exec) {
        const ex = rec.exec[idx];
        if (ex === null) status = '<span class="tag rej">Rejected</span>';
        else if (ex < units) status = `<span class="lease part">Only ${ex} of ${units} were still on the shelf (conflict)</span>`;
      }
      const act = rec.pending && inPlan
        ? `<div class="act"><button class="btn small" data-a="${idx}" ${decisions[idx] ? 'aria-pressed="true"' : ''}>${decisions[idx] ? 'Approved' : 'Approve'}</button><button class="btn small no" data-r="${idx}">${decisions[idx] ? 'Reject' : 'Rejected'}</button></div>` : '';
      return `<li class="card"><div class="route"><b>${FAC[d.i].name} → ${FAC[d.j].name}</b><span>${units} unit${units === 1 ? '' : 's'} · ${d.r}d left</span></div>
        <div><span class="tag ${d.reason}">${d.reason === 'rescue' ? 'Expiry rescue' : 'Top-up'}</span></div>
        <p>${reasonText(d)}</p>${lease}${status}${act}</li>`;
    }).join('');
  }
  $('sugg').addEventListener('click', e => {
    const a = e.target.closest('[data-a]'), r = e.target.closest('[data-r]');
    if (!awaiting) return;
    if (a) decisions[+a.dataset.a] = true;
    if (r) decisions[+r.dataset.r] = false;
    renderSuggestions(cur); draw();
  });
  $('apply').addEventListener('click', () => { if (awaiting) finishDay(); });

  function renderCompare() {
    const a = sim.tot, b = shadow.tot;
    const saved = (b.waste + b.short) - (a.waste + a.short);
    $('compare').innerHTML = `<span class="h"></span><span class="h">Damu Grid</span><span class="h">No coordination</span>
      <span>Units expired</span><span class="v us">${a.waste}</span><span class="v">${b.waste}</span>
      <span>Requests unmet</span><span class="v us">${a.short}</span><span class="v">${b.short}</span>
      <span>Units moved</span><span class="v us">${a.moved}</span><span class="v">0</span>
      <span>Conflicts</span><span class="v us" style="color:${a.conf ? 'var(--unmet)' : ''}">${a.conf}</span><span class="v">0</span>
      <span class="saved">${saved >= 0 ? saved + ' platelet units saved' : 'Behind by ' + (-saved) + ' units'} over ${sim.t} days</span>`;
  }
  function renderLedger() {
    $('ledger').innerHTML = ledger.slice(0, 60).map(d => d.items.map(([c, s]) => `<li class="${c}"><b>Day ${d.t + 1}</b>${s}</li>`).join('')).join('');
  }
  function renderFacility() {
    const i = selected, f = FAC[i], P = sim.P, rec = cur;
    if (!rec) return;
    const stock = rec.pending ? rec.start[i] : rec.end[i], view = rec.view ? rec.view[i] : null, d = P.delays[i];
    const mx = Math.max(1, ...stock.slice(1), ...(view ? view.slice(1) : [0]));
    let bars = '';
    for (let r = P.L; r >= 1; r--) {
      const c = rgba(life(r, P.L));
      bars += `<div class="row"><span>${r} day${r > 1 ? 's' : ''}</span><div class="track"><div class="b" style="width:${100 * stock[r] / mx}%;background:${c}"></div>${view ? `<div class="b view" style="width:${100 * view[r] / mx}%;color:${c}"></div>` : ''}</div><span>${stock[r]}${view && view[r] !== stock[r] ? '/' + view[r] : ''}</span></div>`;
    }
    $('pane-fac').innerHTML = `<div class="fac"><h3>${f.name}</h3><p class="sub">${f.role}</p>
      <div class="lbl" style="margin-bottom:4px">Data link</div>
      <div class="seg" role="group" aria-label="Data link for ${f.name}">${[0, 1, 2, 4].map(v => `<button data-d="${v}" aria-pressed="${d === v}">${v ? v + ' days late' : 'Live'}</button>`).join('')}</div>
      <div class="stats"><div><b>${P.lam[i]}</b><span>units/day demand (avg)</span></div><div><b>${P.target[i]}</b><span>two-day safety level</span></div><div><b>${d ? d + ' d' : 'live'}</b><span>age of hub’s data</span></div></div>
      <div class="lbl">Stock by shelf life left${rec.pending ? ' (start of day)' : ' (end of day)'}</div>
      <div class="bars">${bars}</div>
      <div class="keyline"><span>solid = actual shelf</span>${view ? `<span>striped = what the hub ${sim.useNowcast ? 'estimates' : 'sees'}</span>` : ''}</div>
      <div class="stats"><div><b>${rec.dem ? rec.dem[i] : '–'}</b><span>requests today</span></div><div><b style="color:var(--unmet)">${facTot[i].u}</b><span>unmet so far</span></div><div><b style="color:var(--expired)">${facTot[i].x}</b><span>expired so far</span></div></div></div>`;
  }
  $('pane-fac').addEventListener('click', e => {
    const b = e.target.closest('[data-d]'); if (!b) return;
    sim.P.delays[selected] = +b.dataset.d;
    document.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-selected', 'false'));
    $('storyline').textContent = `Custom: you changed ${FAC[selected].name}’s data link. The change applies from the next day.`;
    renderFacility();
  });
  function showTab(k) {
    ['sugg', 'fac', 'log'].forEach(n => { $('tab-' + n).setAttribute('aria-selected', String(n === k)); $('pane-' + n).hidden = n !== k; });
    if (k === 'fac') renderFacility(); if (k === 'log') renderLedger();
  }
  ['sugg', 'fac', 'log'].forEach(n => $('tab-' + n).addEventListener('click', () => showTab(n)));

  // sparkline
  function drawSpark() {
    const c = $('spark'), d = window.devicePixelRatio || 1, w = c.clientWidth || 260, h = 64;
    c.width = w * d; c.height = h * d; const g = c.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h);
    const a = sim.days.map(x => x.cum), b = shadow.days.map(x => x.cum), n = Math.max(a.length, 2), mx = Math.max(1, ...b, ...a);
    const line = (arr, col, fill) => { g.beginPath(); arr.forEach((v, k) => { const x = 4 + (w - 8) * k / (n - 1), y = h - 14 - (h - 22) * v / mx; k ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.strokeStyle = col; g.lineWidth = 2; g.stroke(); if (fill) { g.lineTo(4 + (w - 8) * (arr.length - 1) / (n - 1), h - 14); g.lineTo(4, h - 14); g.fillStyle = fill; g.fill(); } };
    line(b, PAL.muted); line(a, PAL.accent, rgba(hex(PAL.accent), .12));
    g.font = '10px "IBM Plex Mono", monospace'; g.fillStyle = PAL.muted; g.fillText('cumulative cost · grey = no coordination', 4, h - 2);
  }

  // ---------------------------------------------------------------- loop & controls
  function setMode(m) { mode = m; $('play').textContent = m === 'play' ? 'Pause' : 'Play'; }
  function frame(ts) {
    const dt = last ? Math.min(400, ts - last) : 16; last = ts;   // tolerate slow devices and projectors
    if ((mode === 'play' || mode === 'step') && !awaiting) {
      phase += dt / (DAY_MS / speed) * (reduce ? 4 : 1);
      if (phase >= 1) {
        if (mode === 'step') { phase = 1; setMode('pause'); }
        else { phase = 0; beginDay(); }
      }
    }
    draw();
    requestAnimationFrame(frame);
  }
  $('play').addEventListener('click', () => setMode(mode === 'play' ? 'pause' : 'play'));
  $('step').addEventListener('click', () => { if (awaiting) { finishDay(); mode = 'step'; return; } if (phase < 1 && cur && !cur.pending) phase = 1; beginDay(); if (!awaiting) { phase = 0; mode = 'step'; } });
  $('speed').addEventListener('change', e => speed = +e.target.value);
  $('reset').addEventListener('click', () => setStory(storyIdx));
  $('l-now').addEventListener('change', e => { sim.useNowcast = e.target.checked; customNote(); });
  $('l-lease').addEventListener('change', e => { sim.lease = e.target.checked; customNote(); });
  $('auto').addEventListener('change', () => { if (auto() && awaiting) finishDay(); });
  function customNote() { $('storyline').textContent = `${STORIES[storyIdx].text} (Layers changed: nowcast ${sim.useNowcast ? 'on' : 'off'}, quota leases ${sim.lease ? 'on' : 'off'}.)`; }
  document.addEventListener('keydown', e => {
    if (e.target.closest('input,select,textarea')) return;
    if (e.code === 'Space') { e.preventDefault(); $('play').click(); }
    if (e.code === 'ArrowRight') { e.preventDefault(); $('step').click(); }
  });
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  mq.addEventListener && mq.addEventListener('change', () => { readPalette(); drawBase(); drawSpark(); });
  window.addEventListener('resize', () => { resize(); drawSpark(); });

  // ---------------------------------------------------------------- boot
  readPalette();
  $('story').innerHTML = STORIES.map((s, i) => `<button class="chip" role="tab" aria-selected="false"><b>${i + 1}</b>${s.title}</button>`).join('');
  document.querySelectorAll('.chip').forEach((c, i) => c.addEventListener('click', () => setStory(i)));
  setStory(0);
  setMode(mode);
  fetch('data/kenya_map.json').then(r => r.json()).then(m => { MAP = m; resize(); }).catch(() => resize());
  resize();
  requestAnimationFrame(frame);
})();

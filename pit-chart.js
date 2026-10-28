/* The Pit — the graph. One canvas: the pit (ember), the setpoint (dashed), each meat in its own colour, marks at the
   steps, Cook done and the hold, his notes at their minute. A scrub line follows the finger and the readout stays
   while it is down (FireBoard's users: the pop-up vanishes too fast). The full view pans and pinches.
   Only the scrub line moves between redraws, and it moves by transform. */
'use strict';
class PitChart {
  constructor(host, opts) {
    this.host = host; this.opts = opts || {};
    this.canvas = host.querySelector('canvas') || host.appendChild(document.createElement('canvas'));
    this.scrub = host.querySelector('.scrub') || host.appendChild(Object.assign(document.createElement('div'), { className: 'scrub' }));
    this.readout = host.querySelector('.readout') || host.appendChild(Object.assign(document.createElement('div'), { className: 'readout' }));
    this.ctx = this.canvas.getContext('2d');
    this.win = null; this.pointers = new Map(); this.hideTimer = null;
    const h = this.onPointer.bind(this);
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerleave']) host.addEventListener(t, h);
    if (window.ResizeObserver) { this.ro = new ResizeObserver(() => this.draw()); this.ro.observe(host); }
  }
  destroy() { if (this.ro) this.ro.disconnect(); clearTimeout(this.hideTimer); }
  setData(d) { this.d = d; if (this.win) this.clampWin(); this.draw(); }
  layout() { const W = this.host.clientWidth, H = this.host.clientHeight, pad = { l: 38, r: 54, t: 26, b: 22 }; return { W, H, pad, pw: W - pad.l - pad.r, ph: H - pad.t - pad.b }; }
  domain() {
    const d = this.d, t0 = this.win ? this.win[0] : d.t0, t1 = Math.max(this.win ? this.win[1] : d.t1, t0 + 10 * MINUTE);
    let lo = Infinity, hi = -Infinity;
    for (const s of d.series) { if (d.hidden[s.key]) continue; for (const p of s.pts) if (p[1] != null && p[0] >= t0 && p[0] <= t1) { if (p[1] < lo) lo = p[1]; if (p[1] > hi) hi = p[1]; } }
    if (!isFinite(lo)) { lo = 50; hi = 300; }
    const span = Math.max(40, hi - lo), step = span > 320 ? 100 : span > 130 ? 50 : 25;
    return { t0, t1, yMin: Math.max(0, Math.floor((lo - span * .08) / step) * step), yMax: Math.ceil((hi + span * .14) / step) * step, step };
  }
  clampWin() { const d = this.d; if (!this.win) return; let [a, b] = this.win; const D = Math.max(10 * MINUTE, Math.min(b - a, d.t1 - d.t0)); if (a < d.t0) { a = d.t0; } if (a + D > d.t1) a = d.t1 - D; this.win = D >= d.t1 - d.t0 - MINUTE ? null : [a, a + D]; }
  draw() {
    if (!this.d) return;
    const { W, H, pad, pw, ph } = this.layout(); if (W < 60 || H < 60) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.canvas.width !== Math.round(W * dpr) || this.canvas.height !== Math.round(H * dpr)) { this.canvas.width = Math.round(W * dpr); this.canvas.height = Math.round(H * dpr); }
    const ctx = this.ctx; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const dm = this.dm = this.domain(), d = this.d;
    const x = this.x = t => pad.l + (t - dm.t0) / (dm.t1 - dm.t0) * pw, y = this.y = v => pad.t + (dm.yMax - v) / (dm.yMax - dm.yMin) * ph;
    this.geo = { W, H, pad, pw, ph };
    // grid: hairlines one step off the panel
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(242,234,232,.07)'; ctx.fillStyle = INK_FAINT; ctx.font = '500 10px "IBM Plex Mono", Menlo, monospace'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let v = dm.yMin; v <= dm.yMax + 0.1; v += dm.step) { const yy = Math.round(y(v)) + .5; ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(W - pad.r, yy); ctx.stroke(); ctx.fillText(String(v), pad.l - 6, yy); }
    const spanH = (dm.t1 - dm.t0) / HOUR, stepH = [0.25, 0.5, 1, 2, 3, 4, 6, 12].find(s => spanH / s <= (pw > 600 ? 10 : 6)) || 24;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const first = new Date(dm.t0); first.setMinutes(0, 0, 0);
    let tt = first.getTime() - (stepH >= 1 ? (first.getHours() % stepH) * HOUR : 0);
    for (; tt <= dm.t1; tt += stepH * HOUR) { if (tt < dm.t0) continue; const xx = Math.round(x(tt)) + .5; ctx.beginPath(); ctx.moveTo(xx, pad.t); ctx.lineTo(xx, pad.t + ph); ctx.stroke(); ctx.fillText(stepH < 1 ? fmtClock(tt) : fmtHour(tt), xx, pad.t + ph + 6); }
    // marks: a hairline and a word at the top; two rows so close ones never overlap
    ctx.font = '500 9.5px "IBM Plex Mono", Menlo, monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const rowEnd = [-1e9, -1e9], colors = { done: '#FFB37A', hold: '#3FD07A', step: INK_DIM, note: '#FFB37A', alert: '#FFB0AA', meat: INK_FAINT };
    for (const m of d.marks) {
      if (m.t < dm.t0 || m.t > dm.t1) continue;
      const xx = Math.round(x(m.t)) + .5, minor = m.minor && !this.opts.full;
      ctx.strokeStyle = m.kind === 'done' || m.kind === 'hold' ? 'rgba(255,179,122,.35)' : 'rgba(242,234,232,.16)';
      ctx.beginPath(); ctx.moveTo(xx, minor ? pad.t + ph - 6 : pad.t); ctx.lineTo(xx, pad.t + ph); ctx.stroke();
      if (minor) continue;
      let label = m.label.length > 22 ? m.label.slice(0, 21) + '…' : m.label; const w = ctx.measureText(label).width;
      let row = rowEnd[0] <= xx ? 0 : rowEnd[1] <= xx ? 1 : -1;
      if (row < 0) continue;                                   // no room: the scrub readout still names it
      let lx = xx + 3; if (lx + w > W - 2) lx = xx - w - 3;
      ctx.fillStyle = colors[m.kind] || INK_DIM; ctx.fillText(label, lx, 2 + row * 11); rowEnd[row] = lx + w + 8;
    }
    // series
    ctx.save(); ctx.beginPath(); ctx.rect(pad.l, pad.t - 2, pw, ph + 4); ctx.clip();
    const ends = [];
    for (const s of d.series) {
      if (d.hidden[s.key]) continue;
      ctx.beginPath(); ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = s.color; ctx.globalAlpha = s.alpha || 1; ctx.setLineDash(s.dash ? [4, 4] : []);
      let pen = false, prev = null, lastPt = null;
      for (const p of s.pts) {
        if (p[1] == null) { pen = false; prev = null; continue; }
        if (p[0] < dm.t0 - HOUR || p[0] > dm.t1 + HOUR) { prev = p; pen = false; continue; }
        const px = x(p[0]), py = y(p[1]);
        if (!pen) { ctx.moveTo(px, py); pen = true; }
        else if (s.step && prev) { ctx.lineTo(px, y(prev[1])); ctx.lineTo(px, py); }
        else ctx.lineTo(px, py);
        prev = p; if (p[0] >= dm.t0 && p[0] <= dm.t1) lastPt = p;
      }
      ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      if (lastPt && !s.noLabel) ends.push({ s, p: lastPt });
    }
    ctx.restore();
    // end markers (a ring in the panel colour, then the dot) and the latest value, in ink, with a colour key
    ctx.font = '600 11px "IBM Plex Mono", Menlo, monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const labels = ends.map(e => ({ e, ly: y(e.p[1]) })).sort((a, b) => a.ly - b.ly);
    for (let i = 1; i < labels.length; i++) if (labels[i].ly - labels[i - 1].ly < 13) labels[i].ly = labels[i - 1].ly + 13;
    for (let i = labels.length - 1; i >= 0; i--) { const max = pad.t + ph - 6 - (labels.length - 1 - i) * 13; if (labels[i].ly > max) labels[i].ly = max; }
    for (const { e, ly } of labels) {
      const px = x(e.p[0]), py = y(e.p[1]);
      ctx.beginPath(); ctx.fillStyle = PANEL_COLOR; ctx.arc(px, py, 6.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.fillStyle = e.s.color; ctx.arc(px, py, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = e.s.color; ctx.fillRect(W - pad.r + 7, ly - 5, 3, 10);
      ctx.fillStyle = INK; ctx.fillText(String(rnd(e.p[1])) + '°', W - pad.r + 14, ly);
    }
    this.times = (d.series[0] ? d.series[0].pts : []).map(p => p[0]);
    if (this.host.classList.contains('live') && this.lastClientX != null) this.showAt(this.lastClientX);
  }
  tAt(clientX) { const r = this.host.getBoundingClientRect(), { pad, pw } = this.geo, dm = this.dm; return dm.t0 + Math.min(1, Math.max(0, (clientX - r.left - pad.l) / pw)) * (dm.t1 - dm.t0); }
  nearest(t) { const ts = this.times; if (!ts.length) return -1; let lo = 0, hi = ts.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (ts[mid] < t) lo = mid + 1; else hi = mid; } if (lo > 0 && Math.abs(ts[lo - 1] - t) < Math.abs(ts[lo] - t)) lo--; return lo; }
  showAt(clientX) {
    if (!this.dm || !this.geo) return;
    this.lastClientX = clientX;
    const i = this.nearest(this.tAt(clientX)); if (i < 0) return;
    const t = this.times[i], { W, pad } = this.geo, px = this.x(t);
    if (t < this.dm.t0 - MINUTE || t > this.dm.t1 + MINUTE) { this.hide(0); return; }
    this.scrub.style.transform = `translateX(${px.toFixed(1)}px)`;
    const rows = this.d.series.filter(s => !this.d.hidden[s.key]).map(s => { const p = s.pts[i]; return p && p[1] != null && Math.abs(p[0] - t) < 3 * MINUTE ? `<div class="r" style="--c:${s.color}"><i></i><b>${rnd(p[1])}°</b><span>${esc(s.label)}</span></div>` : ''; }).join('');
    const near = this.d.marks.filter(m => Math.abs(m.t - t) <= 2 * MINUTE && !(m.minor && !this.opts.full)).map(m => esc(m.label)).join(' · ');
    this.readout.innerHTML = `<div class="t">${fmtClock(t)}</div>${rows}${near ? `<div class="m">${near}</div>` : ''}`;
    const rw = this.readout.offsetWidth || 130, left = px > W / 2 ? px - rw - 10 : px + 10;
    this.readout.style.transform = `translateX(${Math.max(2, Math.min(W - rw - 2, left)).toFixed(1)}px)`;
    this.host.classList.add('live'); clearTimeout(this.hideTimer);
  }
  hide(delay) { clearTimeout(this.hideTimer); this.hideTimer = setTimeout(() => { this.host.classList.remove('live'); this.lastClientX = null; }, delay); }
  onPointer(ev) {
    if (!this.d || !this.geo) return;
    const zoomable = !!this.opts.zoom;
    if (ev.type === 'pointerdown') {
      this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      try { this.host.setPointerCapture(ev.pointerId); } catch (e) { /* fine */ }
      this.down = true; this.dragged = false; this.startX = ev.clientX; this.panStart = this.win ? this.win.slice() : null;
      if (this.pointers.size === 2 && zoomable) { const [a, b] = Array.from(this.pointers.values()); this.pinch = { ta: this.tAt(a.x), tb: this.tAt(b.x) }; this.hide(0); }
      else this.showAt(ev.clientX);
    } else if (ev.type === 'pointermove') {
      if (this.pointers.has(ev.pointerId)) this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (this.pointers.size === 2 && zoomable && this.pinch) { this.doPinch(); return; }
      if (this.down) {
        if (zoomable && this.win && this.panStart) {
          const dx = ev.clientX - this.startX; if (Math.abs(dx) > 4) this.dragged = true;
          if (this.dragged) { const D = this.panStart[1] - this.panStart[0], dt = -dx / this.geo.pw * D; this.win = [this.panStart[0] + dt, this.panStart[1] + dt]; this.clampWin(); this.hide(0); this.draw(); return; }
        }
        this.showAt(ev.clientX);
      } else if (ev.pointerType === 'mouse') this.showAt(ev.clientX);
    } else {
      this.pointers.delete(ev.pointerId); this.pinch = null;
      if (ev.type === 'pointerleave' && ev.pointerType === 'mouse') this.hide(0);
      else if (this.pointers.size === 0) { this.down = false; this.hide(4000); }
    }
  }
  doPinch() {
    const [a, b] = Array.from(this.pointers.values()), { pad, pw } = this.geo;
    const ua = (a.x - this.host.getBoundingClientRect().left - pad.l) / pw, ub = (b.x - this.host.getBoundingClientRect().left - pad.l) / pw;
    if (Math.abs(ub - ua) < 0.02) return;
    const D = (this.pinch.tb - this.pinch.ta) / (ub - ua); if (!(D > 0)) return;
    const t0 = this.pinch.ta - ua * D;
    this.win = [t0, t0 + D]; this.clampWin(); this.draw();
  }
  zoomTo(win) { this.win = win; if (win) this.clampWin(); this.draw(); }
}

// A meat card's last hour, 96x30 CSS pixels.
function drawSpark(canvas, pts, color) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), W = 96, H = 30;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const v = pts.filter(p => p[1] != null); if (v.length < 2) return;
  const t0 = v[0][0], t1 = v[v.length - 1][0] || t0 + 1; let lo = Infinity, hi = -Infinity;
  for (const p of v) { if (p[1] < lo) lo = p[1]; if (p[1] > hi) hi = p[1]; }
  if (hi - lo < 4) { const m = (hi + lo) / 2; lo = m - 2; hi = m + 2; }
  ctx.beginPath(); ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = color;
  v.forEach((p, i) => { const x = 3 + (p[0] - t0) / Math.max(1, t1 - t0) * (W - 6), y = 3 + (hi - p[1]) / (hi - lo) * (H - 6); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.stroke();
  const l = v[v.length - 1]; ctx.beginPath(); ctx.fillStyle = color; ctx.arc(3 + (l[0] - t0) / Math.max(1, t1 - t0) * (W - 6), 3 + (hi - l[1]) / (hi - lo) * (H - 6), 3, 0, Math.PI * 2); ctx.fill();
}
// A cook card's whole cook, 110x54 CSS pixels: the pit and each meat, no axes.
function drawThumb(canvas, readings, probes) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), W = 110, H = 54;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  if (!readings || readings.length < 2) return;
  const t0 = readings[0].at, t1 = readings[readings.length - 1].at;
  const lines = [{ color: PIT_COLOR, pts: readings.map(r => [r.at, r.pit]) }].concat(Object.values(probes || {}).map((pid, i) => ({ color: MEAT_COLORS[i % 4], pts: readings.map(r => [r.at, r.probes[pid]]) })));
  let lo = Infinity, hi = -Infinity;
  for (const l of lines) for (const p of l.pts) if (p[1] != null) { if (p[1] < lo) lo = p[1]; if (p[1] > hi) hi = p[1]; }
  if (!isFinite(lo)) return;
  for (const l of lines) {
    ctx.beginPath(); ctx.lineWidth = 1.5; ctx.strokeStyle = l.color; let pen = false;
    for (const p of l.pts) { if (p[1] == null) { pen = false; continue; } const x = 2 + (p[0] - t0) / Math.max(1, t1 - t0) * (W - 4), y = 2 + (hi - p[1]) / Math.max(1, hi - lo) * (H - 4); if (pen) ctx.lineTo(x, y); else { ctx.moveTo(x, y); pen = true; } }
    ctx.stroke();
  }
}

/* The Pit — core: state, the notebook (Supabase) client, the shapes of a reading, an event and a cook, the sample
   cooks, and buildView(): everything a screen needs about a cook, computed once per render.
   Plain scripts share one global scope with engine/pit-engine.js, so every name here stays clear of the engine's. */
'use strict';
const CFG = window.PIT_CONFIG || {};
const ENGINE = typeof PitEngine !== 'undefined' ? PitEngine : null;
const APP_VERSION = '202610281752';
const MEAT_COLORS = ['#3987E5', '#D55181', '#9085E9', '#199E70'];   // one per meat in the plan's order; the six checks pass on the panel
const PIT_COLOR = '#E8632A', PANEL_COLOR = '#15100F', INK = '#F2EAE8', INK_DIM = '#9A8C8A', INK_FAINT = '#5E5250';
const MINUTE = 60000, HOUR = 3600000;
const STALE_MINUTES = ENGINE ? ENGINE.RULES.staleMinutes : 5;

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rnd = v => Math.round(v);
const tms = x => typeof x === 'number' ? x : Date.parse(x);
const capFirst = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
const fmtClock = t => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(' ', ' ');
const fmtHour = t => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric' }).toLowerCase().replace(' ', '');
const fmtDay = t => new Date(t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const fmtDur = minutes => { const m = Math.max(0, minutes), h = Math.floor(m / 60), mm = Math.round(m % 60); return h ? `${h}h ${String(mm).padStart(2, '0')}m` : `${mm}m`; };
const fmtAgo = (t, now) => { const s = Math.max(0, (now - t) / 1000); if (s < 60) return `${rnd(s)} s ago`; if (s < 3600) return `${rnd(s / 60)} min ago`; return `${(s / 3600).toFixed(1)} h ago`; };
const wideScreen = () => window.matchMedia('(min-width:760px)').matches;
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private window: fine */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* same */ } },
};

// ---- state ------------------------------------------------------------------------------------------------
const S = {
  mode: null,              // 'live' | 'demo'
  session: null, pit: null, plans: [],
  cook: null, readings: [], events: [],   // the live cook
  last: null,              // the last reading with no cook
  history: [], histData: {},              // past cooks; id -> { readings, events }
  orders: [],              // his orders this session: { id, action, value, at, status }
  tab: 'now', sub: null, hidden: {},      // hidden: legend toggles
  now: () => Date.now(),   // the demo moves this
  view: null, chart: null, timer: null, fastUntil: 0, busy: false,
};

// ---- the notebook -----------------------------------------------------------------------------------------
const sb = {
  url: CFG.supabaseUrl, key: CFG.supabaseKey,
  headers(auth) { const h = { apikey: this.key, 'Content-Type': 'application/json' }; if (auth && S.session) h.Authorization = 'Bearer ' + S.session.access_token; return h; },
  async signIn(email, password) {
    const r = await fetch(`${this.url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: this.headers(false), body: JSON.stringify({ email, password }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(/invalid/i.test(j.error_description || j.msg || '') ? 'Wrong email or password.' : (j.error_description || j.msg || j.message || 'Sign-in failed.'));
    this.setSession(j); return j;
  },
  setSession(j) {
    S.session = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + ((j.expires_in || 3600) - 30) * 1000,
      user: j.user ? { email: j.user.email, id: j.user.id } : (S.session && S.session.user) || null };
    store.set('pit.session', S.session);
  },
  async refresh() {
    if (!S.session || !S.session.refresh_token) return false;
    const r = await fetch(`${this.url}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: this.headers(false), body: JSON.stringify({ refresh_token: S.session.refresh_token }) });
    if (!r.ok) return false;
    this.setSession(await r.json()); return true;
  },
  async ensure() {
    if (!S.session) throw new Error('Not signed in.');
    if (S.session.expires_at < Date.now() && !(await this.refresh())) { this.signOut(); throw new Error('Your sign-in expired. Sign in again.'); }
  },
  async rest(path, opts) {
    opts = opts || {};
    await this.ensure();
    const r = await fetch(`${this.url}/rest/v1/${path}`, Object.assign({}, opts, { headers: Object.assign(this.headers(true), opts.headers || {}) }));
    if (r.status === 401) { if (await this.refresh()) return this.rest(path, opts); this.signOut(); throw new Error('Signed out.'); }
    if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(`${r.status}: ${t.slice(0, 160)}`); }
    return r.status === 204 ? null : r.json();
  },
  get(path) { return this.rest(path); },
  insert(table, row) { return this.rest(table, { method: 'POST', body: JSON.stringify(row), headers: { Prefer: 'return=representation' } }); },
  patch(path, body) { return this.rest(path, { method: 'PATCH', body: JSON.stringify(body), headers: { Prefer: 'return=representation' } }); },
  signOut() {
    const s = S.session; S.session = null; store.del('pit.session');
    if (s) fetch(`${this.url}/auth/v1/logout`, { method: 'POST', headers: { apikey: this.key, Authorization: 'Bearer ' + s.access_token } }).catch(() => {});
  },
};

// ---- shapes -----------------------------------------------------------------------------------------------
// A reading, from the notebook (setpoint, lid_open…) or the sample cooks (set, lidOpen…), into one shape.
function normReading(r) {
  if (!r) return null;
  const probes = {}, src = r.probes || {};
  for (const k of Object.keys(src)) { const v = src[k]; probes[k] = typeof v === 'number' && v >= 1 && v <= 500 ? v : null; }
  return {
    at: tms(r.at), pit: typeof r.pit === 'number' ? r.pit : null,
    set: typeof r.set === 'number' ? r.set : typeof r.setpoint === 'number' ? r.setpoint : null,
    heating: !!r.heating, power: r.power !== false, fah: r.fah !== false,
    lid: !!(r.lidOpen != null ? r.lidOpen : r.lid_open), door: !!(r.doorOpen != null ? r.doorOpen : r.door_open),
    probes, errors: (r.errors || []).filter(e => e), rssi: typeof r.rssi === 'number' ? r.rssi : null,
    range: r.range || { min: S.pit ? S.pit.range_min : 150, max: S.pit ? S.pit.range_max : 700 },
  };
}
function normEvent(e, i) {
  if (!e || !e.text) return null;                       // the sim's bare order rows carry no words
  const d = e.data || {};
  return { id: e.id != null ? e.id : i, at: tms(e.at), kind: String(e.kind || 'note').toLowerCase(), text: e.text, track: e.track || null,
    step: e.step || null, phase: e.phase || d.phase || null, ask: Array.isArray(e.ask) && e.ask.length === 2 ? e.ask : null,
    who: e.who || d.who || 'engine', alarm: e.alarm || d.alarm || null, tell: e.tell !== false };
}
// A cook row from the notebook: the engine's own cook (state) plus the row's fields.
function normCook(row) {
  if (!row) return null;
  const st = row.state || {};
  return Object.assign({}, st, {
    id: row.id, status: row.status, plan: st.plan || { name: 'Cook', probes: [], tracks: { pit: [] } }, probes: st.probes || {}, tracks: st.tracks || {},
    phase: st.phase || 'cook', startedAt: tms(st.startedAt || row.started_at), phaseAt: st.phaseAt ? tms(st.phaseAt) : null,
    endedAt: row.ended_at ? tms(row.ended_at) : st.endedAt ? tms(st.endedAt) : null, heartbeatAt: row.heartbeat_at ? tms(row.heartbeat_at) : null,
    meat: row.meat || st.meat || null, weightLb: row.weight_lb || st.weightLb || null, notes: row.notes || '', rating: row.rating || null,
    runnerUrl: row.runner_url || null, planId: row.plan_id || null, resting: st.resting || [], rested: st.rested || {}, restSet: st.restSet || null,
    lastSet: st.lastSet, pending: st.pending || null, failed: st.failed || null, alarms: st.alarms || {}, timers: st.timers || [], demo: false,
  });
}

// ---- the sample cooks (made by the engine on a pretend smoker; never real cooks) ----------------------------
const DEMO = { files: { brisket: 'sample/brisket.json', ribs: 'sample/ribs-chicken.json' }, labels: { brisket: 'Brisket, Monclova low n slow', ribs: 'Ribs and chicken, Fiesta style' },
  plans: ['monclova-low-n-slow', 'rapido-y-jarioso', 'rapido-y-jarioso-beef', 'fiesta-style', 'just-watch'], data: {}, which: 'brisket', t: null };
async function loadDemoData() {
  for (const [k, f] of Object.entries(DEMO.files)) if (!DEMO.data[k]) {
    const j = await (await fetch(f)).json();
    const readings = j.readings.map(normReading).sort((a, b) => a.at - b.at);
    const events = j.events.map(normEvent).filter(Boolean).sort((a, b) => a.at - b.at);
    const pids = Object.keys(readings[0].probes).sort(), probes = {};
    (j.plan.probes || []).forEach((role, i) => { if (pids[i]) probes[role] = pids[i]; });
    const done = events.find(e => e.phase === 'rest' && /^Cook done/.test(e.text));
    DEMO.data[k] = { key: k, plan: j.plan, readings, events, probes, t0: events[0].at, tEnd: readings[readings.length - 1].at, tDone: done ? done.at : null };
  }
  if (!DEMO.planRows) {
    const rows = [];
    for (const name of DEMO.plans) { try { const p = await (await fetch(`sample/${name}.json`)).json(); rows.push({ id: 'demo-' + name, name: p.name, plan: p, archived: false }); } catch (e) { /* a missing sample plan is not fatal */ } }
    const saved = store.get('pit.demo.plans') || [];
    DEMO.planRows = rows.concat(saved);
  }
}
// The cook as the engine would hold it at time t, read back from the events up to t.
function demoCookAt(d, t) {
  const ev = d.events.filter(e => e.at <= t), tracks = {}, counts = {};
  for (const e of ev) if (e.track && !e.phase && (e.kind === 'step' || e.kind === 'ask')) { counts[e.track] = (counts[e.track] || 0) + 1; tracks[e.track] = { step: counts[e.track] - 1, since: e.at, ended: false }; }
  let phase = 'cook', phaseAt = d.t0;
  for (const e of ev) if ((e.phase === 'rest' && phase === 'cook') || e.phase === 'hold') { phase = e.phase; phaseAt = e.at; }
  if (phase !== 'cook') for (const [role, st] of Object.entries(tracks)) {
    const step = (d.plan.tracks[role] || [])[st.step] || {};
    st.ended = role === 'pit' || !(step.until && 'minutes' in step.until) || t - st.since > step.until.minutes * MINUTE;
  }
  const ended = ev.some(e => /^Cook ended/.test(e.text) || /^Closed the cook/.test(e.text));
  const roles = Object.keys(d.probes), rested = {};
  for (const r of roles) if (ev.some(e => e.phase === 'hold' || new RegExp(`^The ${r} rested to`).test(e.text))) rested[r] = true;
  const lastSet = (d.readings.filter(r => r.at <= t).pop() || {}).set;
  return { id: 'demo-' + d.key, status: ended ? 'done' : 'running', plan: d.plan, probes: d.probes, tracks, phase, phaseAt, startedAt: d.t0,
    endedAt: ended ? ev[ev.length - 1].at : null, resting: phase !== 'cook' ? roles : [], rested, restSet: 150, lastSet, pending: null, failed: null, alarms: {},
    meat: null, weightLb: null, notes: store.get(`pit.demo.notes.${d.key}`) || '', rating: store.get(`pit.demo.rating.${d.key}`) || null, runnerUrl: null, demo: true };
}
function demoJumps(d) {
  const j = [{ label: 'Start', t: d.t0 + 12 * MINUTE }];
  for (const e of d.events) if (e.track === 'pit' && !e.phase && e.at > d.t0 + MINUTE) j.push({ label: e.step || 'step', t: e.at + 5 * MINUTE });
  if (d.tDone) j.push({ label: 'Cook done', t: d.tDone + 4 * MINUTE });
  const hold = d.events.find(e => e.phase === 'hold'); if (hold) j.push({ label: 'Hold', t: hold.at + 20 * MINUTE });
  j.push({ label: 'End', t: d.tEnd });
  return j;
}

// ---- what a screen needs about a cook ---------------------------------------------------------------------
function describeUntil(u, role, track, now) {
  if ('minutes' in u) {
    const left = track && track.since ? Math.max(0, u.minutes - (now - track.since) / MINUTE) : null;
    return { kind: 'minutes', value: u.minutes, left, text: left == null ? `for ${fmtDur(u.minutes)}` : left > 0 ? `${fmtDur(left)} left` : 'time is up', html: left == null ? `for <b>${fmtDur(u.minutes)}</b>` : left > 0 ? `<b>${fmtDur(left)}</b> left` : 'time is up' };
  }
  const probe = 'stall' in u ? (u.stall === true ? role : u.stall) : u.probe || (role === 'pit' ? null : role);
  if ('stall' in u) return { kind: 'stall', probe, text: role === 'pit' ? `until the ${probe} stalls` : 'until the stall', html: role === 'pit' ? `until the ${esc(probe)} stalls` : 'until the stall' };
  if ('at_least' in u) return { kind: 'at_least', value: u.at_least, probe, text: role === 'pit' ? `until the ${probe} hits ${u.at_least}` : `until ${u.at_least}`, html: role === 'pit' ? `until the ${esc(probe)} hits <b>${u.at_least}</b>` : `until <b>${u.at_least}</b>` };
  return { kind: 'at_most', value: u.at_most, probe, text: role === 'pit' ? `until the ${probe} is down to ${u.at_most}` : `down to ${u.at_most}`, html: role === 'pit' ? `until the ${esc(probe)} is down to <b>${u.at_most}</b>` : `down to <b>${u.at_most}</b>` };
}
// °F per hour over the last 30 minutes (null until there are 20 minutes of readings)
function rateOf(pts, now) {
  const valid = pts.filter(p => p[1] != null && p[0] <= now);
  if (valid.length < 2) return null;
  const end = valid[valid.length - 1], cut = end[0] - 30 * MINUTE;
  let start = null;
  for (const p of valid) { if (p[0] <= cut) start = p; else break; }
  if (!start) { if (end[0] - valid[0][0] < 20 * MINUTE) return null; start = valid[0]; }
  const dh = (end[0] - start[0]) / HOUR;
  return dh > 0 ? (end[1] - start[1]) / dh : null;
}
// The engine's own stall test for the badge: less than a degree of rise over the last 20 minutes.
function flatFor20(pts, now) {
  const valid = pts.filter(p => p[1] != null && p[0] <= now); if (!valid.length) return false;
  const cut = valid[valid.length - 1][0] - 20 * MINUTE;      // the window ends at the last reading, like the engine's look
  let base = null; for (const p of valid) { if (p[0] <= cut) base = p; else break; }
  if (!base) return false;
  const win = valid.filter(p => p[0] > base[0]);
  return win.length >= 4 && Math.max.apply(null, win.map(p => p[1])) - base[1] < 1;
}
function openAsks(events, now) {
  const asks = events.filter(e => e.ask && now - e.at <= 3 * HOUR && e.at <= now);
  const answered = a => S.orders.some(o => o.at > a.at && ['answer', 'retry', 'resume', 'keep', 'end'].includes(o.action))
    || events.some(e => e.at > a.at && e.at <= now && (/^Hector: /.test(e.text) || /^Keeping \d+°F\.$/.test(e.text) || e.text === 'Back to the plan.' || /^Cook ended/.test(e.text) || (e.kind === 'clear' && a.alarm && e.alarm === a.alarm)));
  return asks.filter(a => !answered(a)).slice(-2).reverse();
}
function marksOf(events, cook) {
  const m = [];
  for (const e of events) {
    if (e.phase === 'rest' && /^Cook done/.test(e.text)) m.push({ t: e.at, label: 'Cook done', kind: 'done' });
    else if (e.phase === 'hold') m.push({ t: e.at, label: 'Hold', kind: 'hold' });
    else if (e.track && !e.phase && (e.kind === 'step' || e.kind === 'ask')) {
      if (e.at <= cook.startedAt + MINUTE) continue;
      if (e.track === 'pit') m.push({ t: e.at, label: e.step || 'step', kind: 'step' });
      else m.push({ t: e.at, label: `${e.track}: ${e.step || ''}`.trim(), kind: 'meat', minor: true });
    } else if (e.kind === 'note' && e.who === 'hector') m.push({ t: e.at, label: e.text, kind: 'note' });
    else if (e.kind === 'alert') m.push({ t: e.at, label: e.text, kind: 'alert', minor: true });
  }
  return m;
}
function buildView(cook, readings, events, now) {
  const plan = cook.plan || { name: 'Cook', probes: [], tracks: { pit: [] } };
  const last = readings.length ? readings[readings.length - 1] : null;
  const online = !!last && now - last.at <= STALE_MINUTES * MINUTE;
  const roles = (plan.probes || []).filter(r => cook.probes && cook.probes[r]).map((role, i) => {
    const pid = cook.probes[role], color = MEAT_COLORS[i % MEAT_COLORS.length];
    const pts = readings.map(r => [r.at, r.probes ? r.probes[pid] : null]);
    let li = pts.length - 1; while (li >= 0 && pts[li][1] == null) li--;
    const lastPt = li >= 0 ? pts[li] : null, temp = lastPt ? lastPt[1] : null;
    const stale = !!lastPt && now - lastPt[0] > 10 * MINUTE;
    const rate = stale ? null : rateOf(pts, now), track = cook.tracks[role] || null, steps = plan.tracks[role] || [];
    const step = track ? steps[track.step] || null : null;
    let until = step && step.until ? describeUntil(step.until, role, track, now) : null;
    // A meat with no track of its own shows the line the pit's step waits on ("until 197", "until the stall").
    const pitTrack = cook.tracks.pit, pitStepNow = pitTrack ? (plan.tracks.pit || [])[pitTrack.step] : null;
    if (!until && !track && pitStepNow && pitStepNow.until && !('minutes' in pitStepNow.until) && cook.phase === 'cook') {
      const u = pitStepNow.until, waitsOn = 'stall' in u ? u.stall : u.probe;
      if (waitsOn === role) until = describeUntil(u, role, pitTrack, now);
    }
    const ended = !!(track && track.ended) || (!track && cook.phase !== 'cook'), resting = cook.phase === 'rest' && (cook.resting || []).includes(role) && !(cook.rested || {})[role];
    const stalled = cook.phase === 'cook' && temp != null && temp >= 150 && flatFor20(pts, now) && !ended;
    let pace = null;
    if (cook.phase === 'cook' && until && until.kind === 'at_least' && temp != null && until.value > temp && rate != null && rate >= 1.5 && now - cook.startedAt >= 30 * MINUTE) {
      const h = (until.value - temp) / rate; if (h <= 24) pace = { at: now + h * HOUR, value: until.value };
    }
    return { role, pid, color, temp, stale, tempAt: lastPt ? lastPt[0] : null, rate, pts, track, steps, step, until, ended, resting, stalled, pace, spark: pts.filter(p => p[0] >= now - 60 * MINUTE && p[0] <= now) };
  });
  const pitSteps = plan.tracks.pit || [], pt = cook.tracks.pit || { step: 0 }, pitStep = pitSteps[pt.step] || null;
  const pit = { temp: last ? last.pit : null, set: last ? last.set : null, heating: !!(last && last.heating), step: pitStep, idx: pt.step, next: pitSteps[pt.step + 1] || null,
    steps: pitSteps, until: pitStep && pitStep.until ? describeUntil(pitStep.until, 'pit', pt, now) : null, ended: !!pt.ended,
    stepTimes: events.filter(e => e.track === 'pit' && !e.phase && (e.kind === 'step' || e.kind === 'ask')).map(e => e.at) };
  const sw = ENGINE ? ENGINE.switches(S.pit && S.pit.alerts) : { door: true, lid: false };
  const sensors = { online, lastHeard: last ? last.at : null, door: !sw.door ? 'off' : last && last.door ? 'open' : 'closed', lid: !sw.lid ? 'off' : last && last.lid ? 'open' : 'closed',
    power: last ? last.power : null, rssi: last ? last.rssi : null, errors: last ? last.errors : [], fah: last ? last.fah : null };
  const phase = cook.status === 'paused' ? 'paused' : cook.phase;
  const doneEv = events.find(e => e.phase === 'rest' && /^Cook done/.test(e.text)), holdEv = events.find(e => e.phase === 'hold');
  const timers = (cook.timers || []).map(t => ({ name: t.name, minutes: t.minutes, at: tms(t.at), told: !!t.told, left: Math.max(0, (tms(t.at) - now) / MINUTE) }));
  return { cook, plan, roles, pit, asks: openAsks(events, now), marks: marksOf(events, cook), sensors, phase, last, now, elapsed: now - cook.startedAt,
    doneAt: doneEv ? doneEv.at : null, holdAt: holdEv ? holdEv.at : null, events, timers };
}
// The readings behind a view: the live cook's (up to now) on the Now tab, a past cook's whole set elsewhere.
function readingsOf(v) {
  const live = S.cook && S.cook.id === v.cook.id && S.tab === 'now';
  return live ? S.readings : (S.histData[v.cook.id] || {}).readings || (S.cook && S.cook.id === v.cook.id ? S.readings : []);
}
function chartDataOf(v) {
  const readings = readingsOf(v);
  const series = [
    { key: 'pit', label: 'Pit', color: PIT_COLOR, pts: readings.map(r => [r.at, r.pit]) },
    { key: 'set', label: 'Setpoint', color: PIT_COLOR, dash: true, step: true, alpha: .55, noLabel: true, pts: readings.map(r => [r.at, r.set || null]) },
  ].concat(v.roles.map(r => ({ key: r.role, label: capFirst(r.role), color: r.color, pts: r.pts })));
  const lastAt = readings.length ? readings[readings.length - 1].at : v.cook.startedAt;
  return { t0: v.cook.startedAt, t1: Math.max(lastAt, Math.min(v.now, v.cook.endedAt || v.now)), series, marks: v.marks, hidden: S.hidden };
}
function csvOf(readings, roles) {
  const pids = roles.map(r => r.pid), head = ['time', 'pit', 'setpoint', 'heating', 'power', 'door_open', 'lid_open'].concat(roles.map(r => `${r.role} (${r.pid})`), ['rssi', 'errors']);
  const rows = readings.map(r => [new Date(r.at).toISOString(), r.pit, r.set, r.heating ? 1 : 0, r.power ? 1 : 0, r.door ? 1 : 0, r.lid ? 1 : 0].concat(pids.map(p => r.probes[p] == null ? '' : r.probes[p]), [r.rssi == null ? '' : r.rssi, (r.errors || []).join(' ')]));
  return [head].concat(rows).map(r => r.join(',')).join('\n');
}

// ---- the probes a pit can read, and the plan the basic start writes -------------------------------------------
// The smoker's four ports today (p0–p3, shown as Probe 1–4). A wireless thermometer later: its driver lists its ids in
// pits.probes and writes them into readings.probes; anything seen in a reading shows up here too.
function probeSources() {
  const list = S.pit && Array.isArray(S.pit.probes) && S.pit.probes.length ? S.pit.probes.map(p => ({ id: p.id, label: p.label || p.id })) : [0, 1, 2, 3].map(i => ({ id: 'p' + i, label: 'Probe ' + (i + 1) }));
  const seen = S.cook ? (S.readings[S.readings.length - 1] || {}).probes : (S.last || {}).probes;
  for (const id of Object.keys(seen || {})) if (!list.some(p => p.id === id)) list.push({ id, label: id.toUpperCase() });
  return list;
}
const slugRole = name => String(name || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^[_0-9]+|_+$/g, '');
// meats: [{ probe, name, target }] (a name makes it a meat; a target makes the engine tell him);
// setTemp: the pit's setpoint at start, or null to leave the smoker alone; points: [{ at, set }] on the meat `follow`.
function composePlan(o) {
  const errors = [], roles = [], probes = {}, tracks = {};
  for (const m of o.meats || []) {
    const role = slugRole(m.name); if (!role) continue;
    if (roles.includes(role)) { errors.push(`Two meats are called "${role}".`); continue; }
    roles.push(role); probes[role] = m.probe;
    if (m.target) tracks[role] = [{ name: 'Watching', until: { at_least: +m.target } }, { name: 'There', tell: `The ${role} reached ${+m.target}°F ({${role}}°F now).` }];
  }
  const points = (o.points || []).filter(p => p.at && p.set).map(p => ({ at: +p.at, set: +p.set })).sort((a, b) => a.at - b.at);
  const follow = points.length ? slugRole(o.follow) : null;
  if (points.length && !roles.includes(follow)) errors.push('Cooking points need a meat to follow: name the meat on its probe.');
  const setTemp = o.setTemp ? +o.setTemp : null;
  let pit;
  if (points.length) {
    pit = [{ name: 'Start', set: setTemp || undefined, until: { probe: follow, at_least: points[0].at } }];
    points.forEach((p, i) => pit.push(Object.assign({ name: `at ${p.at}`, set: p.set }, points[i + 1] ? { until: { probe: follow, at_least: points[i + 1].at } } : {}, { tell: `The ${follow} hit ${p.at}°F: pit to ${p.set}.` })));
    if (!setTemp) delete pit[0].set;
  } else pit = [setTemp ? { name: 'Start', set: setTemp, tell: `Pit at ${setTemp}.` } : { name: 'Watching', tell: 'Watching the pit. Only you change the smoker.' }];
  const max = Math.min(700, Math.max(325, setTemp || 0, ...points.map(p => p.set)));
  const plan = { name: points.length ? 'Cooking points' : setTemp ? `Pit at ${setTemp}` : 'Just watch', for: 'today', max_pit: max, probes: roles, tracks: Object.assign({ pit }, tracks) };
  if (ENGINE) errors.push(...ENGINE.validatePlan(plan, { min: S.pit ? S.pit.range_min : 150, max: S.pit ? S.pit.range_max : 700 }));
  return { plan, probes, errors: Array.from(new Set(errors)) };
}

// The Pit — the cook engine. One call of check() = one look at a running cook (every 2 minutes during a cook).
// Pure: no network, no clock of its own, nothing random. n8n's "The Pit — Check" runs this file in a Code node;
// `node projects/the-pit/engine/test/run.js` runs it against pretend cooks. Every temperature is °F (the driver
// converts). The plan format, Hector's recipes and these rules in plain words: projects/the-pit/README.md.
// It never pauses by itself (Hector 10-28: "never make it pause for anything just make it notify me"): an alert only
// tells him, every alert has a switch, and the plan goes on. Only his own Pause button holds the plan.
'use strict';

const RULES = {
  meatConfirm: 2,                              // readings in a row past a meat line before a step moves
  stall: { flatFor: 20, rise: 1, from: 150 },  // Hector 10-28: "20 min of the meat temperature not moving a single degree", watched from 150
  staleMinutes: 5,                             // a reading older than this = the smoker is offline
  readFailsAlert: 3,                           // failed reads in a row before telling him (6 minutes)
  probeMin: 1, probeMax: 500, glitchJump: 40,  // outside the range, or this big a jump in one check = a glitch
  glitchAlertAfter: 3,
  fireDying: { under: 25, minutes: 15 },
  runningHot: { over: 50, minutes: 10 },
  openMinutes: 5,
  restTo: 160,                                 // Hector 10-28: after Cook done the meat rests off the smoker "until 160-155", then the hold
  holdFloor: 140,                              // meat under this in the hold = alert (food safety)
  realertMinutes: 30,
  askAtHours: 36, closeAtHours: 48,
  resends: 1,
};

// Every alert has a switch (Hector 10-28: "put them all but make it so i can activate them or deactivate them").
// A switch only decides whether he hears it. Off = not watched at all (a stuck sensor's readings count nowhere); his
// hand and refused orders still change what the engine believes, with a quiet line in the log. Heat proof 10-28:
// doorOpn is the ash door; his 1050 (firmware 3.0.01) never reports lidOpn (the main door only beeps) or the hopper.
// A half-clicked ash switch stops the fan while doorOpn still says closed: the fire alarm is what catches that.
// Defaults: all on but the lid. The switches live with the pit in the notebook.
const ALERTS = {
  fire:        { on: true,  name: 'Fire dying',       when: 'the pit 25°F under the setpoint for 15 minutes and not climbing' },
  hot:         { on: true,  name: 'Running hot',      when: 'the pit 50°F over the setpoint for 10 minutes and not coming down' },
  door:        { on: true,  name: 'Ash door open',    when: 'the ash door (doorOpn) open 5 minutes' },
  lid:         { on: false, name: 'Lid open',         when: "the lid sensor (lidOpn) open 5 minutes; his 1050 doesn't report one" },
  error:       { on: true,  name: 'Smoker error',     when: 'the smoker shows an error code' },
  off:         { on: true,  name: 'Turned off',       when: 'the smoker turned off during a cook' },
  offline:     { on: true,  name: 'Offline',          when: 'no fresh word from the smoker for 5 minutes' },
  unreachable: { on: true,  name: "Can't reach it",   when: "3 failed reads in a row through Masterbuilt's cloud" },
  probe:       { on: true,  name: 'Probe trouble',    when: 'a probe the plan waits on reads wrong 3 looks in a row' },
  hold:        { on: true,  name: 'Hold too cool',    when: 'meat under 140°F during the hold' },
  hand:        { on: true,  name: 'Changed by hand',  when: "the setpoint changed on the smoker or in Masterbuilt's app" },
  order:       { on: true,  name: 'Order not taken',  when: "the smoker didn't take a setpoint, or one wasn't sent (°C, outside its range)" },
  long:        { on: true,  name: '36-hour check-in', when: 'a cook has run 36 hours' },
  silent:      { on: true,  name: 'Engine silent',    when: "the engine missed its looks for 10 minutes (the notebook's watchdog)" },
};
// His switches (only the ones he changed are stored) over the defaults.
function switches(alerts) {
  const on = {};
  for (const [k, a] of Object.entries(ALERTS)) on[k] = alerts && typeof alerts[k] === 'boolean' ? alerts[k] : a.on;
  return on;
}

const ms = iso => Date.parse(iso);
const mins = (a, b) => (ms(b) - ms(a)) / 60000;
const r0 = v => Math.round(v);
const copy = o => JSON.parse(JSON.stringify(o));
const inRange = v => typeof v === 'number' && v >= RULES.probeMin && v <= RULES.probeMax;
const clock = iso => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });

// ---- plans -----------------------------------------------------------------------------------------------

const PLAN_KEYS = new Set(['name', 'for', 'notes', 'max_pit', 'probes', 'tracks']);
const STEP_KEYS = new Set(['name', 'set', 'until', 'tell', 'ask']);
const UNTIL_KEYS = new Set(['minutes', 'probe', 'at_least', 'at_most', 'stall', 'flat_for', 'from']);

// The probe a condition waits on: `stall` names it (true = the track's own), `probe` names it, a meat track's own.
function probeOf(u, role) {
  if ('stall' in u) return u.stall === true ? role : u.stall;
  return u.probe || (role === 'pit' ? null : role);
}

function validatePlan(plan, range) {
  range = range || { min: 150, max: 700 };
  const errors = [], bad = m => errors.push(m);
  if (!plan || typeof plan !== 'object') return ['A plan must be an object.'];
  for (const k of Object.keys(plan)) if (!PLAN_KEYS.has(k)) bad(`Unknown word "${k}".`);
  if (!plan.name || typeof plan.name !== 'string') bad('The plan needs a name.');
  const maxPit = plan.max_pit;
  if (!(maxPit >= range.min && maxPit <= range.max)) bad(`max_pit must be between ${range.min} and ${range.max}.`);
  const roles = Array.isArray(plan.probes) ? plan.probes : [];
  if (!roles.every(r => typeof r === 'string' && /^[a-z][a-z0-9_]*$/.test(r) && r !== 'pit')) bad('probes are short names like "meat".');
  const tracks = plan.tracks || {};
  if (!Array.isArray(tracks.pit) || !tracks.pit.length) bad('Every plan has a "pit" track with at least one step.');
  for (const [role, steps] of Object.entries(tracks)) {
    if (role !== 'pit' && !roles.includes(role)) bad(`Track "${role}" has no probe of that name in "probes".`);
    if (!Array.isArray(steps) || !steps.length) { bad(`Track "${role}" needs steps.`); continue; }
    steps.forEach((s, i) => {
      const at = `${role} step ${i + 1}`;
      for (const k of Object.keys(s)) if (!STEP_KEYS.has(k)) bad(`${at}: unknown word "${k}".`);
      if ('set' in s) {
        if (role !== 'pit') bad(`${at}: only the pit track sets the pit.`);
        else if (!(typeof s.set === 'number' && s.set >= range.min && s.set <= maxPit)) bad(`${at}: set must be between ${range.min} and max_pit (${maxPit}).`);
      }
      if ('ask' in s && !(Array.isArray(s.ask) && s.ask.length === 2 && s.ask.every(a => typeof a === 'string' && a))) bad(`${at}: ask takes two answers.`);
      if (s.until === undefined) { if (i !== steps.length - 1) bad(`${at}: only the last step can wait for you (no "until").`); return; }
      const u = s.until || {};
      for (const k of Object.keys(u)) if (!UNTIL_KEYS.has(k)) bad(`${at}: unknown word "${k}" in until.`);
      const kinds = ['minutes', 'at_least', 'at_most', 'stall'].filter(k => k in u);
      if (kinds.length !== 1) { bad(`${at}: until takes exactly one of minutes, at_least, at_most, stall.`); return; }
      if ('minutes' in u) { if (!(u.minutes > 0)) bad(`${at}: minutes must be more than 0.`); return; }
      const line = u.at_least !== undefined ? u.at_least : u.at_most;
      if (kinds[0] !== 'stall' && !(line > 0 && line < RULES.probeMax)) bad(`${at}: a meat line must be a temperature.`);
      const probe = probeOf(u, role);
      if (!probe || !roles.includes(probe)) bad(`${at}: name the probe this waits on (one of: ${roles.join(', ') || 'none'}).`);
    });
  }
  return errors;
}

// ---- readings --------------------------------------------------------------------------------------------

// A probe's in-range readings, oldest first, without isolated spikes (40°F off the neighbours on both sides;
// the newest point counts as a spike when it jumps 40°F from the one before).
function series(readings, pid) {
  const pts = readings.filter(r => r && r.probes && inRange(r.probes[pid])).map(r => ({ at: r.at, v: r.probes[pid] }));
  return pts.filter((p, i) => {
    const a = pts[i - 1], b = pts[i + 1];
    const offA = a && Math.abs(p.v - a.v) >= RULES.glitchJump, offB = b && Math.abs(p.v - b.v) >= RULES.glitchJump;
    return !(offA && (offB || !b));
  });
}

// role -> its good temperature in the newest reading, or null (missing, unplugged, a glitch)
function tempsNow(cook, all, reading) {
  const temps = {};
  for (const [role, pid] of Object.entries(cook.probes || {})) {
    const s = series(all, pid), last = s[s.length - 1];
    temps[role] = reading && last && last.at === reading.at ? last.v : null;
  }
  return temps;
}

// ---- small helpers on a cook -----------------------------------------------------------------------------

function say(out, kind, text, extra) { out.events.push(Object.assign({ kind, text, tell: true }, extra)); }
function note(out, kind, text, extra) { out.events.push(Object.assign({ kind, text, tell: false }, extra)); }

// A one-time alert behind its switch: told when on, a quiet line in the log when off.
function alert(ctx, sw, text, extra) {
  if (ctx.on[sw]) say(ctx.out, 'alert', text, Object.assign({ alarm: sw }, extra));
  else note(ctx.out, 'note', text, { alarm: sw });
}

// An alarm is an episode: told once when it starts, again every 30 minutes while it lasts, once when it clears.
// Switched off, it isn't watched at all, and an open one closes without a word.
function episode(ctx, name, active, text, clearText, extra) {
  const { cook, out, now } = ctx, a = cook.alarms[name];
  if (!ctx.on[name.split(':')[0]]) { delete cook.alarms[name]; return; }
  if (active) {
    if (!a) { cook.alarms[name] = { since: now, sentAt: now }; say(out, 'alert', text, Object.assign({ alarm: name }, extra)); }
    else if (mins(a.sentAt, now) >= RULES.realertMinutes) { a.sentAt = now; say(out, 'alert', 'Still: ' + text, Object.assign({ alarm: name }, extra)); }
  } else if (a) {
    delete cook.alarms[name];
    if (clearText) say(out, 'clear', clearText, { alarm: name });
  }
}

function fill(text, ctx) {
  return text.replace(/\{(\w+)\}/g, (m, k) => {
    if (k === 'pit') return ctx.reading && typeof ctx.reading.pit === 'number' ? String(r0(ctx.reading.pit)) : '?';
    return ctx.temps[k] != null ? String(r0(ctx.temps[k])) : '?';
  });
}

function setLast(cook, v, now) { if (cook.lastSet !== v) { cook.lastSet = v; cook.setAt = now; } }
function effectiveSet(steps, idx) { for (let i = idx; i >= 0; i--) if (typeof steps[i].set === 'number') return steps[i].set; return null; }

// The setpoint the plan wants now (after Cook done: the smoker's lowest), and the plan's next one.
function planSet(cook) {
  if (cook.phase !== 'cook') return cook.restSet;
  return cook.tracks.pit ? effectiveSet(cook.plan.tracks.pit, cook.tracks.pit.step) : null;
}
function nextSet(cook) {
  if (cook.phase !== 'cook' || !cook.tracks.pit) return null;
  const steps = cook.plan.tracks.pit;
  for (let i = cook.tracks.pit.step + 1; i < steps.length; i++) if (typeof steps[i].set === 'number') return steps[i].set;
  return null;
}

// Ask the smoker for a setpoint. Plan setpoints stay inside the smoker's range and the plan's max; Hector's own
// inside the smoker's range. °F only. One setpoint order per look. Returns why it wasn't sent, or null.
function requestSet(cook, value, ctx, who) {
  const { reading, out } = ctx;
  const range = reading.range || { min: 150, max: 700 };
  const max = who === 'plan' ? Math.min(range.max, cook.plan.max_pit) : range.max;
  let why = null;
  if (!(typeof value === 'number' && value >= range.min && value <= max)) why = `${value}°F is outside ${range.min}–${max}°F, so I didn't send it.`;
  else if (!reading.fah) why = `The smoker is set to °C. I only send °F, so ${value}°F wasn't sent: switch it to °F.`;
  if (why) { if (who === 'plan') alert(ctx, 'order', why + ' The plan goes on.'); return why; }
  out.orders = out.orders.filter(o => !('set' in o));
  cook.failed = null;
  if (reading.set === value) { cook.pending = null; setLast(cook, value, ctx.now); return null; }
  out.orders.push({ set: value });
  cook.pending = { set: value, at: ctx.now, tries: 1, who };
  note(out, 'order', `Sent ${value}°F.`, { who });
  return null;
}

function enter(cook, role, idx, ctx) {
  const step = cook.plan.tracks[role][idx];
  cook.tracks[role] = { step: idx, since: ctx.now };
  const extra = { track: role, step: step.name || null };
  if (step.ask) extra.ask = step.ask;
  if (step.tell) say(ctx.out, step.ask ? 'ask' : 'step', fill(step.tell, ctx), extra);
  else note(ctx.out, 'step', `${role}: ${step.name || 'step ' + (idx + 1)}.`, extra);
  if (role === 'pit' && typeof step.set === 'number') requestSet(cook, step.set, ctx, 'plan');
}

function toHold(ctx, why) {
  const { cook, now } = ctx;
  cook.phase = 'hold'; cook.phaseAt = now;
  say(ctx.out, 'step', `${why}Hold it at ${cook.restSet}°F, in the smoker (I watch the meat) or the oven, as long as you can; 12 hours, even better. Or serve.`, { phase: 'hold' });
}

// Is this step's "until" true right now?
function met(u, role, st, ctx) {
  if ('minutes' in u) return mins(st.since, ctx.now) >= u.minutes - 0.01;
  const probe = probeOf(u, role), pid = ctx.cook.probes[probe];
  if (!pid || ctx.temps[probe] == null) return false;
  const s = series(ctx.all, pid);
  if ('at_least' in u || 'at_most' in u) {
    const last = s.slice(-RULES.meatConfirm);
    return last.length === RULES.meatConfirm && last.every(p => ('at_least' in u ? p.v >= u.at_least : p.v <= u.at_most));
  }
  const flatFor = u.flat_for || RULES.stall.flatFor, from = u.from || RULES.stall.from;
  if (ctx.temps[probe] < from || mins(st.since, ctx.now) < flatFor) return false;
  const cut = ms(ctx.now) - flatFor * 60000;
  const before = s.filter(p => ms(p.at) <= cut), base = before[before.length - 1];
  if (!base) return false;
  const win = s.filter(p => ms(p.at) > ms(base.at));
  return win.length >= 4 && Math.max.apply(null, win.map(p => p.v)) - base.v < RULES.stall.rise;
}

// ---- the three calls -------------------------------------------------------------------------------------

// Start a cook. probes maps the plan's probe names to the smoker's probes ({ meat: 'p0' }); a meat track with no
// probe is skipped (Fiesta with chicken only). The smoker must be on, in °F and heard from in the last 5 minutes.
function startCook({ plan, probes, reading, now, id, meat, weightLb, alerts, tells }) {
  probes = probes || {};
  // "Tell me at X" (the page's extra lines on any plan, Just watch above all): each tell becomes a meat track of its
  // own, in the plan's own format, so nothing new is needed to watch it. [{ name, probe, at }] or [{ name, probe, down_to }].
  const tellErrors = [];
  if (Array.isArray(tells) && tells.length && plan && typeof plan === 'object') {
    plan = copy(plan); probes = Object.assign({}, probes);
    plan.probes = Array.isArray(plan.probes) ? plan.probes.slice() : [];
    plan.tracks = Object.assign({}, plan.tracks);
    for (const t of tells) {
      const role = String((t && t.name) || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^[_0-9]+|_+$/g, '');
      if (!role) { tellErrors.push('A tell needs a name.'); continue; }
      if (plan.probes.includes(role) || plan.tracks[role]) { tellErrors.push(`"${role}" is already in this plan.`); continue; }
      const down = t.down_to !== undefined, line = down ? t.down_to : t.at;
      plan.probes.push(role);
      plan.tracks[role] = [
        { name: 'Watching', until: down ? { at_most: line } : { at_least: line } },
        { name: 'There', tell: `The ${role} ${down ? 'came down to' : 'reached'} ${line}°F ({${role}}°F now).` },
      ];
      probes[role] = t.probe;
    }
  }
  const errors = validatePlan(plan, reading && reading.range).concat(tellErrors);
  if (!reading) errors.push("I can't read the smoker right now.");
  else {
    if (mins(reading.at, now) > RULES.staleMinutes) errors.push('The smoker is offline.');
    if (!reading.power) errors.push('The smoker is off. Turn it on and light it first.');
    if (!reading.fah) errors.push('The smoker is set to °C. Switch it to °F first.');
  }
  const roles = (plan && Array.isArray(plan.probes)) ? plan.probes : [];
  for (const [role, pid] of Object.entries(probes)) {
    if (!roles.includes(role)) errors.push(`This plan has no "${role}" probe.`);
    if (!/^p[0-9]$/.test(pid)) errors.push(`"${pid}" isn't one of the smoker's probes (p0, p1, …).`);
  }
  const pids = Object.values(probes);
  if (new Set(pids).size !== pids.length) errors.push('One probe per meat.');
  for (const s of (plan && plan.tracks && plan.tracks.pit) || []) {
    const need = s.until && !('minutes' in s.until) ? probeOf(s.until, 'pit') : null;
    if (need && !probes[need]) errors.push(`This plan waits on the ${need} probe: say which probe is in the ${need}.`);
  }
  if (errors.length) return { ok: false, errors: Array.from(new Set(errors)) };

  const cook = {
    id: id || null, plan: copy(plan), probes: copy(probes), meat: meat || null, weightLb: weightLb || null,
    status: 'running', pausedFor: null, phase: 'cook', phaseAt: now, startedAt: now, endedAt: null, heartbeatAt: now,
    tracks: {}, lastSet: reading.set, setAt: now, pending: null, failed: null, alarms: {}, glitches: {}, readFails: 0,
    askedLong: false, restSet: null, resting: [], rested: {},
  };
  const out = { orders: [], events: [] };
  const ctx = { cook, reading, now, out, on: switches(alerts), all: [reading], temps: tempsNow(cook, [reading], reading) };
  for (const role of Object.keys(plan.tracks)) if (role === 'pit' || probes[role]) enter(cook, role, 0, ctx);
  return { ok: true, cook, orders: out.orders, events: out.events };
}

// One look at a running cook. reading = the smoker now (null when the read failed); history = this cook's
// readings from the last 45 minutes, oldest first, without this one; alerts = his switches (the pit's, read fresh
// each look). Returns the new cook state, at most one setpoint order, and the events (tell: true = send to his chat).
function check({ cook: c0, reading, history, now, alerts }) {
  const cook = copy(c0), out = { orders: [], events: [] };
  const finish = () => { cook.heartbeatAt = now; return { cook, orders: out.orders, events: out.events }; };
  if (cook.status === 'done' || cook.status === 'stopped') return { cook, orders: [], events: [] };
  cook.alarms = cook.alarms || {}; cook.glitches = cook.glitches || {};
  const ctx = { cook, reading, now, out, on: switches(alerts), all: [], temps: {} };

  // 1. Could we read it at all?
  if (!reading) {
    cook.readFails = (cook.readFails || 0) + 1;
    episode(ctx, 'unreachable', cook.readFails >= RULES.readFailsAlert, "I can't reach the smoker through Masterbuilt's cloud. Still trying every 2 minutes.");
    return finish();
  }
  cook.readFails = 0;
  episode(ctx, 'unreachable', false, '', 'Reaching the smoker again.');

  // 2. Old data is no data.
  const stale = mins(reading.at, now) > RULES.staleMinutes;
  episode(ctx, 'offline', stale, `The smoker is offline: last heard at ${clock(reading.at)}. Nothing changes until it's back.`, 'The smoker is back online.');
  if (stale) return finish();

  // 3. Off means hands off.
  episode(ctx, 'off', !reading.power, 'The smoker is off. End the cook?', 'The smoker is on again.', { ask: ['End the cook', 'Keep it open'] });
  if (!reading.power) return finish();

  const all = ctx.all = (history || []).concat([reading]);
  ctx.temps = tempsNow(cook, all, reading);
  for (const role of Object.keys(cook.probes || {})) cook.glitches[role] = ctx.temps[role] == null ? (cook.glitches[role] || 0) + 1 : 0;

  // 4. Our last order: did the smoker take it? One resend, then he hears about it and the plan goes on.
  if (cook.pending) {
    const p = cook.pending;
    if (reading.set === p.set) { setLast(cook, p.set, now); cook.pending = null; note(out, 'order', `The smoker took ${p.set}°F.`); }
    else if (mins(p.at, now) >= 1.5) {
      if (p.tries <= RULES.resends) { p.tries++; p.at = now; out.orders.push({ set: p.set }); note(out, 'order', `Resent ${p.set}°F.`); }
      else {
        cook.pending = null; setLast(cook, reading.set, now); cook.failed = { set: p.set, who: p.who };
        alert(ctx, 'order', `The smoker didn't take ${p.set}°F (it shows ${reading.set}°F). The plan goes on.`, { ask: ['Try again', 'Leave it'] });
      }
    }
  }

  // 5. His hand on the dial wins, and the plan goes on: his setpoint stands until the plan's next one.
  if (!cook.pending && cook.lastSet != null && reading.set !== cook.lastSet) {
    setLast(cook, reading.set, now);
    const planned = planSet(cook), next = nextSet(cook);
    alert(ctx, 'hand', `Pit set to ${reading.set}°F on the smoker or in Masterbuilt's app. The plan goes on with yours${next != null ? `; its next setpoint is ${next}°F` : ''}.`,
      planned != null && planned !== reading.set ? { ask: ['Back to the plan', 'Keep mine'] } : {});
  }

  // 6. The plan moves. His Pause holds the pit track; meat tracks only talk, so they keep going. After Cook done
  // only a meat track in the middle of a timer is left (the chicken in the cooler).
  for (const role of Object.keys(cook.tracks)) {
    const st = cook.tracks[role];
    if (st.ended) continue;
    const step = cook.plan.tracks[role][st.step];
    if (!step.until || !met(step.until, role, st, ctx)) continue;
    if (role === 'pit' && cook.status !== 'running') {
      if (!st.doneNoted) { st.doneNoted = true; say(out, 'note', `${step.name || 'This step'} is done, but you paused the plan. Resume to go on.`); }
      continue;
    }
    enter(cook, role, st.step + 1, ctx);
  }

  // 7. After Cook done: each meat rests off the smoker down to 160, then the hold. A meat whose probe wasn't
  // reading at Cook done is his call (Rested).
  if (cook.phase === 'rest') {
    for (const role of cook.resting) {
      if (cook.rested[role]) continue;
      const s = series(all, cook.probes[role]).slice(-RULES.meatConfirm);
      if (ctx.temps[role] == null || s.length < RULES.meatConfirm || !s.every(p => p.v <= RULES.restTo)) continue;
      cook.rested[role] = true;
      const said = `The ${role} rested to ${r0(ctx.temps[role])}°F. `;
      if (cook.resting.every(r => cook.rested[r])) toHold(ctx, said);
      else say(out, 'step', said.trim(), { phase: 'rest', track: role });
    }
  }

  // 8. Probes the plan is waiting on that read wrong.
  const needed = new Set();
  for (const role of Object.keys(cook.tracks)) {
    if (cook.tracks[role].ended) continue;
    const step = cook.plan.tracks[role][cook.tracks[role].step];
    if (step.until && !('minutes' in step.until)) needed.add(probeOf(step.until, role));
  }
  for (const role of Object.keys(cook.probes || {})) {
    episode(ctx, 'probe:' + role, needed.has(role) && cook.glitches[role] >= RULES.glitchAlertAfter,
      `The ${role} probe reads wrong (unplugged or moved?). I'm waiting on it.`, `The ${role} probe reads right again.`);
  }

  // 9. Alarms. A door sensor switched off counts nowhere, so a stuck one can't hide a dying fire.
  const recent = m => all.filter(r => ms(r.at) >= ms(now) - m * 60000);
  const held = (m, ok) => { const rs = recent(m); return rs.length >= 3 && mins(rs[0].at, now) >= m - 2.5 && rs.every(ok); };
  const closed = r => !(ctx.on.lid && r.lidOpen) && !(ctx.on.door && r.doorOpen);
  const pitNow = r0(reading.pit), set = reading.set;
  const fire = set > 0 && held(RULES.fireDying.minutes, r => closed(r) && r.set > 0 && r.pit <= r.set - RULES.fireDying.under)
    && reading.pit <= recent(RULES.fireDying.minutes)[0].pit;            // falling or flat, never a pit still climbing
  episode(ctx, 'fire', fire, `Pit ${pitNow}°F, set ${set}°F, and not climbing. Hopper empty, fire out, or the ash door switch not clicked all the way in?`, `Pit back up to ${pitNow}°F.`);
  const hot = set > 0 && held(RULES.runningHot.minutes, r => r.set > 0 && r.pit >= r.set + RULES.runningHot.over)
    && reading.pit >= recent(RULES.runningHot.minutes)[0].pit;           // not a pit already coming down (after Cook done)
  episode(ctx, 'hot', hot, `Pit ${pitNow}°F, set ${set}°F: running hot.`, `Pit back down to ${pitNow}°F.`);
  episode(ctx, 'door', held(RULES.openMinutes, r => r.doorOpen), `The ash door has been open ${RULES.openMinutes} minutes.`, 'The ash door is closed again.');
  episode(ctx, 'lid', held(RULES.openMinutes, r => r.lidOpen), `The lid has been open ${RULES.openMinutes} minutes.`, 'The lid is closed again.');
  const errs = (reading.errors || []).filter(e => e);
  episode(ctx, 'error', errs.length > 0, `The smoker shows error ${errs.join(', ')}.`, 'The error cleared.');
  const low = cook.phase !== 'hold' ? [] : Object.keys(cook.probes || {})
    .filter(r => ctx.temps[r] != null && ctx.temps[r] < RULES.holdFloor).map(r => `the ${r} ${r0(ctx.temps[r])}°F`);
  episode(ctx, 'hold', low.length > 0, `Holding too low: ${low.join(', ')} (under ${RULES.holdFloor}°F).`, `Back above ${RULES.holdFloor}°F.`);

  // 10. No cook runs forever.
  const hours = mins(cook.startedAt, now) / 60;
  if (hours >= RULES.closeAtHours) { cook.status = 'stopped'; cook.endedAt = now; say(out, 'note', `Closed the cook after ${RULES.closeAtHours} hours. The smoker is untouched.`); }
  else if (hours >= RULES.askAtHours && !cook.askedLong) {
    cook.askedLong = true;
    if (ctx.on.long) say(out, 'ask', `This cook has run ${RULES.askAtHours} hours. Still going?`, { ask: ['Still cooking', 'End it'] });
  }
  return finish();
}

// Hector (the app or Jarvis) acting on a cook. reading = the smoker now (needed to send anything).
//   next [track]  the track's next step          pause / resume  his own hold on the plan; resume = back to the plan's setpoint
//   set <°F>      his setpoint (the plan goes on)  retry           send the order the smoker didn't take again
//   done          Cook done: the pit to its lowest, the rest, then the hold
//   rested        the rest is over (a probe that isn't reading)           keep  nothing changes (logged)
//   end           the cook is over                answer <words>  one of an ask's two answers
const ANSWERS = { 'Back to the plan': 'resume', 'Keep mine': 'keep', 'Try again': 'retry', 'Leave it': 'keep', 'End it': 'end', 'End the cook': 'end' };
function act({ cook: c0, action, value, reading, now, alerts }) {
  const cook = copy(c0), out = { orders: [], events: [] };
  const fail = e => ({ ok: false, errors: [e] });
  if (cook.status === 'done' || cook.status === 'stopped') return fail('This cook is over.');
  if (action === 'answer') {
    if (ANSWERS[value]) action = ANSWERS[value];
    else { note(out, 'note', `Hector: ${value}.`); return { ok: true, cook, orders: [], events: out.events }; }
  }
  const needsReading = ['set', 'resume', 'retry', 'done'].includes(action);
  if (needsReading && (!reading || mins(reading.at, now) > RULES.staleMinutes)) return fail("I can't read the smoker right now.");
  const ctx = { cook, reading, now, out, on: switches(alerts), all: reading ? [reading] : [], temps: tempsNow(cook, reading ? [reading] : [], reading) };
  const pit = cook.tracks.pit;
  switch (action) {
    case 'next': {
      const role = value || 'pit', st = cook.tracks[role];
      if (!st) return fail(`This cook has no ${role} track.`);
      if (st.ended) return fail(role === 'pit' ? 'The cook is done: the rest and the hold run on their own.' : `The ${role} is done.`);
      if (st.step >= cook.plan.tracks[role].length - 1) return fail(role === 'pit' ? 'That was the last step: tap Cook done when the meat is off.' : 'That was the last step.');
      if (role === 'pit' && cook.status !== 'running') { cook.status = 'running'; cook.pausedFor = null; }
      if (role === 'pit' && !reading && typeof cook.plan.tracks.pit[st.step + 1].set === 'number') return fail("I can't read the smoker right now.");
      enter(cook, role, st.step + 1, ctx);
      break;
    }
    case 'pause':
      if (cook.phase !== 'cook') return fail('Nothing to pause: the rest and the hold only watch.');
      if (cook.status === 'running') { cook.status = 'paused'; cook.pausedFor = 'hector'; if (pit) pit.doneNoted = false; note(out, 'note', 'Plan paused.'); }
      break;
    case 'resume': {
      cook.status = 'running'; cook.pausedFor = null; if (pit) pit.doneNoted = false;
      note(out, 'note', 'Back to the plan.');
      const v = planSet(cook);
      if (v != null) { const why = requestSet(cook, v, ctx, 'plan'); if (why) return fail(why); }
      break;
    }
    case 'keep':
      note(out, 'note', `Keeping ${cook.lastSet}°F.`);
      break;
    case 'retry': {
      if (!cook.failed) return fail('Nothing to try again.');
      const why = requestSet(cook, cook.failed.set, ctx, cook.failed.who);
      if (why) return fail(why);
      break;
    }
    case 'set': {
      const why = requestSet(cook, value, ctx, 'hector');
      if (why) return fail(why);
      break;
    }
    case 'done': {
      if (cook.phase !== 'cook') return fail('The cook is already done.');
      cook.phase = 'rest'; cook.phaseAt = now; cook.status = 'running'; cook.pausedFor = null;
      // The plan's tracks end, except a meat track in the middle of a timer (the chicken in the cooler).
      for (const [role, st] of Object.entries(cook.tracks)) {
        const u = cook.plan.tracks[role][st.step].until;
        if (role === 'pit' || !(u && 'minutes' in u)) st.ended = true;
      }
      cook.resting = Object.keys(cook.probes).filter(r => ctx.temps[r] != null && !(cook.tracks[r] && !cook.tracks[r].ended));
      cook.rested = {};
      cook.restSet = (reading.range || { min: 150 }).min;
      say(out, 'step', `Cook done. Pit to ${cook.restSet}°F for the hold. ` + (cook.resting.length
        ? `Resting: the ${cook.resting.join(' and the ')}; I'll tell you at ${RULES.restTo}°F.`
        : `Tap Rested when the meat is down to ${RULES.restTo}–155°F.`), { phase: 'rest' });
      requestSet(cook, cook.restSet, ctx, 'plan');                 // refused (°C) = an alert; the rest goes on
      break;
    }
    case 'rested':
      if (cook.phase !== 'rest') return fail(cook.phase === 'cook' ? 'Tap Cook done first.' : 'Already holding.');
      toHold(ctx, 'Rested. ');
      break;
    case 'end':
      cook.status = 'done'; cook.endedAt = now; note(out, 'note', 'Cook ended.');
      break;
    default:
      return fail(`Unknown action "${action}".`);
  }
  return { ok: true, cook, orders: out.orders, events: out.events };
}

const PitEngine = { RULES, ALERTS, switches, validatePlan, startCook, check, act };
if (typeof module !== 'undefined' && module.exports) module.exports = PitEngine;

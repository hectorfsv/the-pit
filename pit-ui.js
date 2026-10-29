/* The Pit — the screens: Now (the pit first and big, then each meat, the graph, the plan, the log), Plans, History, Alerts,
   the live strip and the action bar. Everything is drawn from S and a view built by buildView(); every word from
   the notebook goes through esc(). */
'use strict';
const PHASE_WORD = { cook: 'Cooking', rest: 'Resting', hold: 'Holding', paused: 'Paused' };
const KIND_WORD = { step: 'step', ask: 'asks you', alert: 'alert', clear: 'cleared', order: 'order', note: 'note', error: 'error' };

function renderAll() {
  if (!S.mode) return;
  renderStatus(); renderDemoBar();
  $$('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === S.tab));
  const v = S.view = S.cook ? buildView(S.cook, S.readings, S.events, S.now()) : null;
  const main = $('#main');
  if (S.tab === 'now') main.innerHTML = v ? nowHTML(v) : emptyHTML();
  else if (S.tab === 'plans') main.innerHTML = S.sub ? planViewHTML(S.sub) : plansHTML();
  else if (S.tab === 'history') main.innerHTML = S.sub ? pastHTML(S.sub) : historyHTML();
  else main.innerHTML = alertsHTML();
  afterRender(v);
  renderStrip(v); renderActions(v);
}
function renderStatus() {
  const b = $('#status'); if (!b) return;
  if (S.mode === 'demo') { b.className = 'chip status demo'; b.innerHTML = '<span class="dot"></span>Sample cook'; return; }
  const last = S.cook ? S.readings[S.readings.length - 1] : S.last, now = Date.now();
  if (!last) { b.className = 'chip status'; b.innerHTML = '<span class="dot"></span>no reading yet'; return; }
  const fresh = now - last.at <= STALE_MINUTES * MINUTE;
  // With no cook nothing looks at the smoker on its own: an old reading is an old look, not an offline smoker.
  if (!S.cook) { b.className = 'chip status ' + (fresh ? 'on' : ''); b.innerHTML = `<span class="dot"></span>${fresh ? 'read ' : 'last read '}<span data-age="${last.at}" data-mode="${fresh ? 'ago' : 'clock'}">${fresh ? fmtAgo(last.at, now) : fmtClock(last.at)}</span>`; return; }
  b.className = 'chip status ' + (fresh ? 'on' : 'off');
  b.innerHTML = `<span class="dot"></span>${fresh ? 'online, looked ' : 'offline since '}<span data-age="${last.at}" data-mode="${fresh ? 'ago' : 'clock'}">${fresh ? fmtAgo(last.at, now) : fmtClock(last.at)}</span>`;
}
function renderDemoBar() {
  const bar = $('#demobar'); if (!bar) return;
  if (S.mode !== 'demo' || S.tab !== 'now') { bar.hidden = true; return; }
  const d = DEMO.data[DEMO.which]; if (!d) { bar.hidden = true; return; }
  bar.hidden = false;
  const t = DEMO.t;
  bar.innerHTML = `<div class="row"><span class="lbl">A sample cook, not a real one</span>
      <select id="demo-which" aria-label="Which sample cook">${Object.keys(DEMO.files).map(k => `<option value="${k}"${k === DEMO.which ? ' selected' : ''}>${esc(DEMO.labels[k])}</option>`).join('')}</select>
      <span class="when">${fmtDay(t)} ${fmtClock(t)}, ${fmtDur((t - d.t0) / MINUTE)} in</span></div>
    <input id="demo-t" type="range" min="${d.t0 + 5 * MINUTE}" max="${d.tEnd}" step="60000" value="${t}" aria-label="Move through the cook">
    <div class="jumps">${demoJumps(d).map(j => `<button type="button" data-jump="${j.t}">${esc(j.label)}</button>`).join('')}</div>`;
  $('#demo-t').addEventListener('input', e => { DEMO.t = +e.target.value; applyDemo(); renderAll(); });
  $('#demo-which').addEventListener('change', e => { DEMO.which = e.target.value; DEMO.t = null; applyDemo(); renderAll(); });
  $$('[data-jump]', bar).forEach(b => b.addEventListener('click', () => { DEMO.t = +b.dataset.jump; applyDemo(); renderAll(); }));
}

// ---- Now ----------------------------------------------------------------------------------------------------
function nowHTML(v) {
  const c = v.cook, word = PHASE_WORD[v.phase] || 'Cooking';
  const sinceT = v.phase === 'cook' || v.phase === 'paused' ? c.startedAt : c.phaseAt || c.startedAt;
  const since = `${v.phase === 'cook' ? 'started' : word.toLowerCase() + ' since'} ${fmtClock(sinceT)}, ${fmtDur(v.elapsed / MINUTE)} in`;
  const head = `<div class="phase"><h2><span class="tag ${v.phase}">${word}</span>${esc(v.plan.name)}</h2><div class="since">${esc(since)}</div></div>`;
  const meats = v.roles.map(r => meatHTML(r, v)).join(''), pit = pitHTML(v), asks = v.asks.map(askHTML).join('');
  const graph = graphHTML(v), steps = stepsHTML(v), log = logHTML(v.events, v.now, 6, c), sensors = sensorsHTML(v);
  if (wideScreen()) return `<section class="now">${head}<div class="left">${pit}${meats}${asks}${steps}${sensors}</div><div class="rightcol">${graph}${log}</div></section>`;
  return `<section class="now">${head}${pit}${meats}${asks}${graph}${steps}${log}${sensors}</section>`;
}
function meatHTML(r, v) {
  const temp = r.temp == null ? '<div class="temp none">not reading</div>' : `<div class="temp${r.stale ? ' stale' : ''}">${rnd(r.temp)}<sup>°F</sup></div>`;
  let line = '';
  if (r.resting) line = '<div class="line resting">resting, I tell you at <b>160</b></div>';
  else if (v.phase === 'hold' || (v.phase === 'rest' && r.ended && !r.resting)) line = `<div class="line">${v.phase === 'hold' ? 'holding, watched for <b>140</b>' : 'off the smoker'}</div>`;
  else if (r.ended) line = `<div class="line dim">${esc(r.step && r.step.name || 'off the smoker')}</div>`;
  else if (r.until) line = `<div class="line">${r.until.html}</div>`;
  else if (r.step) line = `<div class="line dim">${esc(r.step.name || 'waits for you')}</div>`;
  else line = '<div class="line dim">no target, just watched</div>';
  const rate = r.rate == null ? '' : `<div class="rate${r.stalled ? ' stall' : ''}">${r.stalled ? 'the stall, ' : ''}${r.rate >= 0 ? '+' : '−'}${Math.abs(r.rate).toFixed(Math.abs(r.rate) >= 10 ? 0 : 1)}°/h</div>`;
  const pace = r.pace ? `<div class="pace">at this pace, ${r.pace.value} around <b>${fmtClock(r.pace.at)}</b></div>` : '';
  const track = r.steps.length > 1 && r.track ? `<div class="track">${r.steps.map((s, i) => `<span class="${i < r.track.step ? 'done' : i === r.track.step ? 'cur' : ''}">${esc(s.name || 'step ' + (i + 1))}</span>`).join('')}</div>` : '<div></div>';
  const age = r.tempAt ? `<span class="age${r.stale ? ' stale' : ''}">${r.stale ? 'last read ' + fmtClock(r.tempAt) : `<span data-age="${r.tempAt}">${fmtAgo(r.tempAt, v.now)}</span>`}</span>` : '';
  return `<article class="meat" style="--c:${r.color}" data-role="${esc(r.role)}">
    <div class="head"><div class="role">${esc(r.role)}${r.step && r.step.name && r.steps.length > 1 ? `<span class="stepname">, ${esc(r.step.name)}</span>` : ''}</div>${age}</div>
    <div class="big">${temp}<div class="right">${line}${rate}${pace}</div></div>
    <div class="foot">${track}<canvas class="spark" data-role="${esc(r.role)}" width="192" height="60" aria-hidden="true"></canvas></div></article>`;
}
function pitHTML(v) {
  const p = v.pit, c = v.cook;
  const temp = p.temp == null ? '<div class="temp none">no reading</div>' : `<div class="temp">${rnd(p.temp)}<sup>°F</sup></div>`;
  const set = p.set ? `<div class="set">set <b>${p.set}</b></div>` : '<div class="set dim">no setpoint</div>';
  const heat = `<div class="heat${p.heating ? ' on' : ''}">${p.heating ? 'heating' : 'holding'}</div>`;
  let line = '';
  if ((v.phase === 'cook' || v.phase === 'paused') && p.step) {
    const s = p.step, last = p.idx === p.steps.length - 1;
    line = `<div class="next"><b>${esc(s.name || 'Step ' + (p.idx + 1))}</b>${typeof s.set === 'number' ? `, pit at ${s.set}` : ''}${p.until ? ', ' + p.until.html : last ? '. The last step: tap Cook done when the meat is off' : ''}${p.next ? ` <span class="dim">then ${esc(p.next.name || 'the next step')}${typeof p.next.set === 'number' ? ` at ${p.next.set}` : ''}</span>` : ''}</div>`;
  } else if (v.phase === 'rest') line = `<div class="next">Cook done. The pit sits at <b>${c.restSet || 150}</b> for the hold.</div>`;
  else if (v.phase === 'hold') line = `<div class="next">Holding at <b>${c.restSet || 150}</b>. The meat is watched for 140.</div>`;
  const pending = c.pending ? `<div class="pending">Sent ${c.pending.set}°F, waiting for the smoker to take it</div>` : c.failed ? `<div class="pending">The smoker didn't take ${c.failed.set}°F</div>` : '';
  const looked = v.sensors.lastHeard ? (v.sensors.online ? `looked <span data-age="${v.sensors.lastHeard}">${fmtAgo(v.sensors.lastHeard, v.now)}</span>` : `offline since ${fmtClock(v.sensors.lastHeard)}`) : 'no reading yet';
  const live = !c.endedAt && c.status !== 'done' && c.status !== 'stopped' && !(S.mode === 'demo' && c.status !== 'running');
  const timers = (v.timers || []).filter(t => !t.told || v.now - t.at < 2 * HOUR).slice(-3).map(t => t.told ? `<span class="tm done">${esc(t.name)}: up at ${fmtClock(t.at)}</span>` : `<span class="tm"><b>${esc(t.name)}</b> ${fmtDur(t.left)} left, ${fmtClock(t.at)}</span>`).join('');
  const tools = live ? `<div class="pit-tools">${timers}<button type="button" class="mini" data-act="timer">Set timer</button></div>` : timers ? `<div class="pit-tools">${timers}</div>` : '';
  return `<article class="pit"><div class="head"><div class="role">Pit</div><div class="stepname">${looked}</div></div><div class="big">${temp}<div class="right">${set}${heat}</div></div>${line}${pending}${tools}</article>`;
}
function askHTML(a) {
  return `<article class="ask"><div class="when">${fmtClock(a.at)}</div><p>${esc(a.text)}</p>
    <div class="two"><button class="btn" data-act="answer" data-v="${esc(a.ask[0])}">${esc(a.ask[0])}</button><button class="btn" data-act="answer" data-v="${esc(a.ask[1])}">${esc(a.ask[1])}</button></div></article>`;
}
function legendHTML(v) {
  const items = [{ key: 'pit', label: 'Pit', color: PIT_COLOR }, { key: 'set', label: 'Setpoint', color: PIT_COLOR, dash: true }].concat(v.roles.map(r => ({ key: r.role, label: capFirst(r.role), color: r.color })));
  return `<div class="legend">${items.map(i => `<button type="button" data-act="legend" data-v="${esc(i.key)}" class="${S.hidden[i.key] ? 'off' : ''}" style="--c:${i.color}" aria-pressed="${!S.hidden[i.key]}"><span class="key${i.dash ? ' dash' : ''}"></span>${esc(i.label)}</button>`).join('')}</div>`;
}
function graphHTML(v) {
  if (!S.readings.length && !(S.histData[v.cook.id] && S.histData[v.cook.id].readings.length)) return '<section class="graph"><div class="empty">No readings yet. The first look draws the first point.</div></section>';
  return `<section class="graph"><div class="ghead">${legendHTML(v)}<button type="button" class="expand" data-act="expand">Full graph</button></div><div class="chart" id="chart"><canvas></canvas><div class="scrub"></div><div class="readout"></div></div></section>`;
}
function stepsHTML(v) {
  const p = v.pit, c = v.cook, cookPhase = v.phase === 'cook' || v.phase === 'paused';
  const li = p.steps.map((s, i) => {
    const st = i < p.idx || (!cookPhase) ? 'done' : i === p.idx ? 'cur' : '';
    const u = s.until ? describeUntil(s.until, 'pit', i === p.idx ? c.tracks.pit : null, v.now) : null;
    const when = p.stepTimes[i] ? fmtClock(p.stepTimes[i]) : '';
    return `<li class="${st}"><span class="b"></span><span><span class="name">${esc(s.name || 'Step ' + (i + 1))}</span> <span class="until">${u ? esc(u.text) : i === p.steps.length - 1 ? 'then tap Cook done' : ''}</span></span><span class="set">${typeof s.set === 'number' ? s.set + '°' : ''}<br><span class="at">${when}</span></span></li>`;
  });
  const tail = [
    { name: 'Cook done', until: 'the pit drops to 150', st: v.doneAt ? 'done' : '', when: v.doneAt },
    { name: 'Rest', until: 'off the smoker, down to 160', st: v.phase === 'hold' ? 'done' : v.phase === 'rest' ? 'cur' : '', when: v.doneAt },
    { name: 'Hold', until: 'at 150, as long as you can; 12 hours even better', st: v.phase === 'hold' ? 'cur' : '', when: v.holdAt },
  ].map(t => `<li class="${t.st}"><span class="b"></span><span><span class="name">${t.name}</span> <span class="until">${t.until}</span></span><span class="set"><br><span class="at">${t.when ? fmtClock(t.when) : ''}</span></span></li>`);
  const canPoint = cookPhase && !c.endedAt && c.status !== 'done' && !(S.mode === 'demo' && c.status !== 'running');
  return `<section class="steps"><h3>${esc(v.plan.name)}${canPoint ? ' <button type="button" class="mini" data-act="points">Cooking points</button>' : ''}</h3><ol>${li.join('')}${tail.join('')}</ol></section>`;
}
function logHTML(events, now, limit, cook) {
  const list = events.filter(e => e.at <= now).slice().reverse();
  const shown = limit ? list.slice(0, limit) : list;
  const li = shown.map(e => `<li class="${esc(e.kind)}"><span class="t">${fmtClock(e.at)}</span><span class="x">${esc(e.text)}${e.who && e.who !== 'engine' ? `<span class="who">${esc(e.who)}</span>` : ''}</span></li>`).join('');
  const more = limit && list.length > limit ? `<button type="button" class="more" data-act="all-events">All ${list.length} events</button>` : '';
  return `<section class="log"><h3>${limit ? 'Lately' : 'Every event'}</h3><ul>${li || '<li><span class="t"></span><span class="x dim">Nothing yet.</span></li>'}</ul>${more}</section>`;
}
function bars(rssi) { const n = rssi == null ? 0 : rssi >= -55 ? 4 : rssi >= -65 ? 3 : rssi >= -75 ? 2 : 1; return `<span class="bars" aria-hidden="true">${[5, 8, 11, 14].map((h, i) => `<i style="height:${h}px" class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`; }
function sensorsHTML(v) {
  const s = v.sensors, door = k => s[k] === 'off' ? '<b>not watched</b>' : `<b>${s[k]}</b>`;
  const chips = [
    `<span class="s${s.door === 'open' ? ' bad' : ''}${s.door === 'off' ? ' off' : ''}">Door ${door('door')}</span>`,
    `<span class="s${s.lid === 'open' ? ' bad' : ''}${s.lid === 'off' ? ' off' : ''}">Lid ${door('lid')}</span>`,
    `<span class="s">${bars(s.rssi)} Wi-Fi <b>${s.rssi == null ? '?' : s.rssi + ' dBm'}</b></span>`,
    s.fah === false ? '<span class="s bad">Units <b>°C</b></span>' : '',
    s.errors && s.errors.length ? `<span class="s bad">Error <b>${esc(s.errors.join(', '))}</b></span>` : '',
    `<button type="button" class="s pw" data-act="power"><b>${s.power === false ? 'Power is off' : 'Power on'}</b></button>`,
  ].join('');
  return `<section class="sensors"><h3>The smoker</h3><div class="row">${chips}</div></section>`;
}
function emptyHTML() {
  const l = S.last, now = Date.now();
  const pids = l ? Object.keys(l.probes).filter(k => l.probes[k] != null) : [];
  const vals = l ? `<div class="lastread"><div class="v"><div class="k">Pit</div><div class="n">${l.pit == null ? '<span class="dim">no reading</span>' : rnd(l.pit) + '°'}</div></div>
      <div class="v"><div class="k">Setpoint</div><div class="n">${l.set ? l.set + '°' : '<span class="dim">none</span>'}</div></div>
      ${pids.map(p => `<div class="v"><div class="k">Probe ${p.slice(1)}</div><div class="n">${rnd(l.probes[p])}°</div></div>`).join('')}
      <div class="v"><div class="k">Power</div><div class="n ${l.power ? '' : 'dim'}">${l.power ? 'on' : 'off'}</div></div></div>` : '';
  const heard = l ? `Last read ${fmtDay(l.at)} at ${fmtClock(l.at)} (<span data-age="${l.at}">${fmtAgo(l.at, now)}</span>).${now - l.at > STALE_MINUTES * MINUTE ? ' Nothing looks on its own between cooks: tap Read now for a fresh look.' : ''}` : 'The smoker has not been read yet.';
  return `<section class="empty-cook"><div class="hero"><h2>No cook running</h2><p>${heard}</p>${vals}</div>
    <div class="go"><button type="button" class="btn primary" data-act="start-cook">Start a cook</button><button type="button" class="btn" data-act="read-now">Read now</button></div>
    <div class="go three"><button type="button" class="btn" data-act="set-pit">Set pit</button><button type="button" class="btn" data-act="power">${l ? (l.power ? 'Power off' : 'Power on') : 'Power'}</button><span class="note dim">${l ? `${l.set ? `Set to ${l.set}°F` : 'No setpoint'}, ${l.power ? 'on' : 'off'} at the last look.` : 'Read the smoker once and the app knows whether it is on.'}</span></div>
    <p class="note dim">Set the pit, name the meat on each probe with the temperature to tell you at, add cooking points if you want the smoker to change on its own. The engine looks every two minutes and tells you in your Jarvis chat; your phone can sleep. A plan from the Plans tab can join at any time.</p></section>`;
}

// ---- Plans --------------------------------------------------------------------------------------------------
function planSummary(p) {
  const steps = (p.tracks && p.tracks.pit) || [];
  if (!steps.length) return '';
  return steps.map(s => { const u = s.until ? describeUntil(s.until, 'pit', null, 0).text : 'then your tap'; return `${typeof s.set === 'number' ? `<b>${s.set}</b> ` : ''}${esc(u)}`; }).join(', ');
}
function plansHTML() {
  const rows = S.plans.filter(p => !p.archived);
  return `<section class="plans">${rows.map(r => `<button type="button" class="plan-card" data-act="open-plan" data-v="${esc(r.id)}"><h3>${esc(r.plan.name)}</h3>${r.plan.for ? `<div class="for">for ${esc(r.plan.for)}</div>` : ''}<div class="sum">${planSummary(r.plan)}</div></button>`).join('')}
    <button type="button" class="plan-card" data-act="new-plan" style="text-align:center;color:var(--ink-dim)">New plan</button></section>`;
}
function trackHTML(role, steps, probes) {
  return `<div class="track"><h4>${role === 'pit' ? 'The pit' : esc(role)}</h4><ol>${steps.map((s, i) => `<li><span class="set${typeof s.set === 'number' ? '' : ' none'}">${typeof s.set === 'number' ? s.set + '°' : '—'}</span><span><span class="nm">${esc(s.name || 'Step ' + (i + 1))}</span> <span class="un">${s.until ? esc(describeUntil(s.until, role, null, 0).text) : i === steps.length - 1 ? (role === 'pit' ? 'then tap Cook done' : 'then it waits') : ''}</span>${s.tell ? `<div class="tell">“${esc(s.tell)}”</div>` : ''}${s.ask ? `<div class="ask">asks: ${esc(s.ask[0])} / ${esc(s.ask[1])}</div>` : ''}</span></li>`).join('')}</ol></div>`;
}
function planViewHTML(id) {
  const r = S.plans.find(p => p.id === id); if (!r) return '<section class="plan-view"><a class="back" href="#plans">Back to plans</a><p class="dim">That plan is gone.</p></section>';
  const p = r.plan, tracks = Object.entries(p.tracks || {});
  return `<section class="plan-view"><a class="back" href="#plans">← Plans</a><h2>${esc(p.name)}</h2>${p.for ? `<div class="dim">for ${esc(p.for)}</div>` : ''}${p.notes ? `<p class="notes">${esc(p.notes)}</p>` : ''}
    <div class="dim" style="font-size:13px">Pit up to ${p.max_pit}°F. Probes: ${(p.probes || []).map(esc).join(', ') || 'none'}.</div>
    ${tracks.map(([role, steps]) => trackHTML(role, steps, p.probes)).join('')}
    <div class="row">${S.cook && !S.cook.endedAt && S.cook.phase === 'cook' && !(S.mode === 'demo' && S.cook.status !== 'running') ? `<button type="button" class="btn primary" data-act="use-plan" data-v="${esc(r.id)}">Use on the running cook</button><button type="button" class="btn" data-act="start-plan" data-v="${esc(r.id)}">Start a new cook with it</button>` : `<button type="button" class="btn primary" data-act="start-plan" data-v="${esc(r.id)}">Start a cook with this plan</button>`}</div>
    <div class="row"><button type="button" class="btn" data-act="edit-plan" data-v="${esc(r.id)}">Edit</button><button type="button" class="btn" data-act="dup-plan" data-v="${esc(r.id)}">Duplicate</button><button type="button" class="btn danger" data-act="archive-plan" data-v="${esc(r.id)}">Archive</button></div></section>`;
}

// ---- History ------------------------------------------------------------------------------------------------
function cookTitle(c) { return `${esc(c.plan && c.plan.name || 'Cook')}${c.meat ? `, ${esc(c.meat)}` : ''}`; }
function historyHTML() {
  if (!S.history.length) return '<section class="hist"><p class="dim">No past cooks yet. The first one lands here when it ends.</p></section>';
  return `<section class="hist">${S.history.map(c => `<button type="button" class="cook-card" data-act="open-cook" data-v="${esc(c.id)}"><div><h3>${cookTitle(c)}</h3><div class="meta">${fmtDay(c.startedAt)}, ${fmtClock(c.startedAt)}${c.endedAt ? `, ${fmtDur((c.endedAt - c.startedAt) / MINUTE)}` : ''}${c.weightLb ? `, ${c.weightLb} lb` : ''}</div><div class="stars${c.rating ? '' : ' none'}">${c.rating ? '★'.repeat(c.rating) + '☆'.repeat(5 - c.rating) : 'not rated'}</div></div><canvas data-thumb="${esc(c.id)}" width="220" height="108" aria-hidden="true"></canvas></button>`).join('')}</section>`;
}
function milestonesHTML(v) {
  const rows = [];
  v.pit.steps.forEach((s, i) => { if (v.pit.stepTimes[i]) rows.push({ t: v.pit.stepTimes[i], label: `${s.name || 'Step ' + (i + 1)}${typeof s.set === 'number' ? `, pit to ${s.set}` : ''}` }); });
  v.roles.forEach(r => v.events.filter(e => e.track === r.role && !e.phase && (e.kind === 'step' || e.kind === 'ask') && e.at > v.cook.startedAt + MINUTE).forEach(e => rows.push({ t: e.at, label: `${r.role}: ${e.step || ''}` })));
  if (v.doneAt) rows.push({ t: v.doneAt, label: 'Cook done, the pit to 150' });
  if (v.holdAt) rows.push({ t: v.holdAt, label: 'Rested, the hold' });
  if (v.cook.endedAt) rows.push({ t: v.cook.endedAt, label: 'Ended' });
  rows.sort((a, b) => a.t - b.t);
  return `<section class="miles"><table>${rows.map(r => `<tr><td class="t">${fmtClock(r.t)}</td><td>${esc(r.label)}</td><td class="d">${fmtDur((r.t - v.cook.startedAt) / MINUTE)}</td></tr>`).join('')}</table></section>`;
}
function pastHTML(id) {
  const c = S.history.find(h => h.id === id); if (!c) return '<section class="past"><a class="back" href="#history">← History</a><p class="dim">That cook is not here.</p></section>';
  const data = S.histData[id];
  if (!data) return `<section class="past"><a class="back" href="#history">← History</a><h2>${cookTitle(c)}</h2><p class="dim">Loading the cook…</p></section>`;
  const v = buildView(c, data.readings, data.events, c.endedAt || (data.readings.length ? data.readings[data.readings.length - 1].at : c.startedAt));
  S.view = v;
  const stars = [1, 2, 3, 4, 5].map(n => `<button type="button" class="${c.rating >= n ? 'on' : ''}" data-act="rate" data-v="${n}" aria-label="${n} of 5">★</button>`).join('');
  return `<section class="past"><a class="back" href="#history">← History</a><h2>${cookTitle(c)}</h2>
    <div class="meta">${fmtDay(c.startedAt)}, started ${fmtClock(c.startedAt)}${c.endedAt ? `, ended ${fmtClock(c.endedAt)} after ${fmtDur((c.endedAt - c.startedAt) / MINUTE)}` : ''}${c.weightLb ? `, ${c.weightLb} lb` : ''}</div>
    ${graphHTML(v)}${milestonesHTML(v)}
    <section class="sect"><h3>Your notes</h3><label class="field"><textarea id="note-text" placeholder="How it went, what to change next time">${esc(c.notes || '')}</textarea></label>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:8px"><button type="button" class="btn" data-act="save-note">Save note</button><div class="rate-row">${stars}<span class="lbl">${c.rating ? c.rating + ' of 5' : 'rate it'}</span></div></div></section>
    ${logHTML(data.events, v.now, 0, c)}
    <button type="button" class="btn quiet" data-act="csv">Download this cook as CSV</button></section>`;
}

// ---- Alerts -------------------------------------------------------------------------------------------------
function alertsHTML() {
  const on = ENGINE ? ENGINE.switches(S.pit && S.pit.alerts) : {};
  const rows = ENGINE ? Object.entries(ENGINE.ALERTS) : [];
  return `<section class="alerts"><p class="intro">Each alert only tells you, in your Jarvis chat and on a phone with alerts on, once and again every 30 minutes while it lasts. Nothing ever pauses the plan. <span class="nw">Off means not watched at all.</span> A flip counts from the engine's next look.</p>
    ${phoneAlertsHTML()}
    ${rows.map(([k, a]) => `<div class="sw"><div><div class="n">${esc(a.name)}</div><div class="w">${esc(a.when)}${k === 'lid' ? ' <span class="nw">(your lid and hopper sensors read closed no matter what)</span>' : ''}</div></div><button type="button" class="tog" role="switch" aria-checked="${on[k] ? 'true' : 'false'}" data-act="toggle" data-v="${k}" aria-label="${esc(a.name)}"><i></i></button></div>`).join('')}</section>`;
}

// ---- the strip and the action bar -----------------------------------------------------------------------------
function renderStrip(v) {
  const s = $('#strip'); if (!s) return;
  if (!v || S.tab === 'now' || v.cook.endedAt || (S.mode === 'demo' && v.cook.status !== 'running')) { s.hidden = true; return; }
  s.hidden = false;
  s.innerHTML = `<span class="ph">${PHASE_WORD[v.phase] || 'Cooking'}</span><span class="v"><span class="key" style="background:${PIT_COLOR}"></span><span class="n">${v.pit.temp == null ? '—' : rnd(v.pit.temp) + '°'}</span><span class="k">pit${v.pit.set ? ' / ' + v.pit.set : ''}</span></span>${v.roles.map(r => `<span class="v"><span class="key" style="background:${r.color}"></span><span class="n">${r.temp == null ? '—' : rnd(r.temp) + '°'}</span><span class="k">${esc(r.role)}</span></span>`).join('')}<span class="go">Now ›</span>`;
}
function renderActions(v) {
  const a = $('#actions'); if (!a) return;
  if (!v || S.tab !== 'now' || v.cook.endedAt || v.cook.status === 'done' || v.cook.status === 'stopped') { a.hidden = true; return; }
  a.hidden = false;
  const paused = v.cook.status === 'paused';
  if (v.phase === 'cook' || v.phase === 'paused') { a.className = 'actions'; a.innerHTML = `<button type="button" class="btn" data-act="set">Set pit</button><button type="button" class="btn" data-act="next">Next step</button><button type="button" class="btn" data-act="${paused ? 'resume' : 'pause'}">${paused ? 'Resume' : 'Pause'}</button><button type="button" class="btn primary" data-act="done">Cook done</button>`; }
  else if (v.phase === 'rest') { a.className = 'actions three'; a.innerHTML = '<button type="button" class="btn" data-act="set">Set pit</button><button type="button" class="btn" data-act="rested">Rested</button><button type="button" class="btn primary" data-act="end">End cook</button>'; }
  else { a.className = 'actions two'; a.innerHTML = '<button type="button" class="btn" data-act="set">Set pit</button><button type="button" class="btn primary" data-act="end">End cook</button>'; }
}

// ---- after the HTML is in: the canvases, lazy loads, the ages ---------------------------------------------------
function afterRender(v) {
  if (S.chart) { S.chart.destroy(); S.chart = null; }
  const host = $('#chart');
  if (host && S.view) { S.chart = new PitChart(host, { zoom: false }); S.chart.setData(chartDataOf(S.view)); }
  if (S.view) for (const c of $$('canvas.spark')) { const r = S.view.roles.find(x => x.role === c.dataset.role); if (r) drawSpark(c, r.spark.length > 1 ? r.spark : r.pts.slice(-30), r.color); }
  for (const c of $$('canvas[data-thumb]')) {
    const id = c.dataset.thumb, data = S.histData[id], cook = S.history.find(h => h.id === id);
    if (data) drawThumb(c, data.readings, cook && cook.probes); else loadHistData(id).then(() => { if (document.body.contains(c) && S.histData[id]) drawThumb(c, S.histData[id].readings, cook && cook.probes); });
  }
  if (S.tab === 'history' && S.sub && !S.histData[S.sub]) loadHistData(S.sub).then(() => renderAll());
}
function tickAges() {
  const now = S.now();
  for (const el of $$('[data-age]')) { const t = +el.dataset.age; el.textContent = el.dataset.mode === 'clock' ? fmtClock(t) : fmtAgo(t, S.mode === 'demo' ? now : Date.now()); }
}

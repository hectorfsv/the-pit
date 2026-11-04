/* The Pit — the screens: Now (the pit first and big, then each meat, the graph, the plan, the log), Plans, History, Alerts,
   the live strip and the action bar. Everything is drawn from S and a view built by buildView(); every word from
   the notebook goes through esc(). */
'use strict';
const PHASE_WORD = { cook: 'Cooking', rest: 'Resting', hold: 'Holding', paused: 'Paused' };
const KIND_WORD = { step: 'step', ask: 'asks you', alert: 'alert', clear: 'cleared', order: 'order', note: 'note', error: 'error' };

// A new reading rebuilds the screen. On a remote his place has to survive that: the ring stays where he left it.
function focusKey() {
  const a = document.activeElement; if (!a || a === document.body || !a.dataset) return null;
  const at = a.closest('.bottom') ? '.bottom ' : '#main ';
  if (a.dataset.tab) return `${at}[data-tab="${a.dataset.tab}"]`;
  if (a.dataset.act) return `${at}[data-act="${a.dataset.act}"]${a.dataset.v ? `[data-v="${a.dataset.v}"]` : ''}`;
  return a.dataset.spot ? `${at}[data-spot="${a.dataset.spot}"]` : null;
}
function refocus(key) { const el = key && document.querySelector(key); if (el) el.focus({ preventScroll: true }); }
function renderAll() {
  if (!S.mode) return;
  const place = TV ? focusKey() : null;
  renderStatus(); renderDemoBar();
  $$('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === S.tab));
  const v = S.view = viewNow();
  const main = $('#main');
  S.sbOn = S.tab === 'now' && !!v && standbyWanted(v);
  main.classList.toggle('sb', S.sbOn);
  if (S.sbOn) { main.innerHTML = standbyHTML(v); standbyFacts(); }
  else if (S.tab === 'now') main.innerHTML = nowHTML(v);
  else if (S.tab === 'plans') main.innerHTML = S.sub ? planViewHTML(S.sub) : plansHTML();
  else if (S.tab === 'history') main.innerHTML = S.sub ? pastHTML(S.sub) : historyHTML();
  else main.innerHTML = alertsHTML();
  afterRender(v);
  S.liveShape = S.tab === 'now' && v ? liveShape(v) : null;
  renderStrip(v); renderActions(v);
  if (TV && !$('#sheet-root .overlay')) {
    // what the arrows can't otherwise reach: a section with nothing to press still takes the ring, so the page scrolls to it
    $$('.now .steps ol,.now .log ul,.now .sensors').forEach((e, i) => { e.tabIndex = 0; e.dataset.spot = i; });
    refocus(place);
    if (document.activeElement === document.body) { const el = (S.sbOn && $('#main .standby')) || $('#main .pit [data-act]') || $('#main button,#main a[href]') || $('.tabs a.on'); if (el) el.focus({ preventScroll: true }); }
  }
}
// The Now view: the cook (or the smoker alone) with the live row as the newest reading while it is fresh.
function viewNow() {
  const live = liveReading();
  if (S.cook) return buildView(S.cook, S.readings, S.events, S.now(), live);
  return S.tab === 'now' ? buildView(idleCook(), [], [], S.now(), live || S.last) : null;
}
// A live report changes the numbers where they stand: the graph, the sparklines and his place on the remote stay.
// Anything that changes the screen's shape redraws it: a thermometer plugged or pulled, the power, a door, an error,
// live starting or stopping. The graph only ever moves with its 2-minute points.
function liveShape(v) {
  const s = v.sensors;
  return JSON.stringify([v.cook.id, v.tiles.map(r => [r.pid, r.temp == null, r.stale, r.live]), v.pit.temp == null, !!v.pit.set, v.last && v.last.power, !!(v.last && v.last.live), s.online, s.door, s.lid, s.fah, (s.errors || []).join()]);
}
function renderLive() {
  if (!S.mode) return;
  const v = viewNow();
  if (S.tab !== 'now' || !v) { renderStatus(); renderStrip(v); return; }
  if (liveShape(v) !== S.liveShape || !$(S.sbOn ? '#main .standby' : '#main .pit')) { renderAll(); return; }
  S.view = v;
  if (S.sbOn) { patchStandby(v); renderStatus(); renderStrip(v); return; }
  const p = v.pit, num = (el, t) => { if (el && t != null) el.innerHTML = `${rnd(t)}<sup>°F</sup>`; };
  num($('#main .pit .temp'), p.temp);
  const st = $('#main .pit .set-temp'); if (st) st.innerHTML = `Set temp${p.set ? ` <b>${p.set}</b>` : ''}`;
  const heat = $('#main .pit .heat'); if (heat && !(v.last && v.last.power === false)) { heat.textContent = p.heating ? 'heating' : 'holding'; heat.classList.toggle('on', p.heating); }
  for (const r of v.tiles) num($(`#main .meat[data-pid="${CSS.escape(r.pid)}"] .temp`), r.temp);
  renderStatus(); renderStrip(v);
}
function renderStatus() {
  const b = $('#status'); if (!b) return;
  if (S.mode === 'demo') { b.className = 'chip status demo'; b.innerHTML = '<span class="dot"></span>Sample cook'; return; }
  const l = liveReading();   // the smoker reports with the power off too (for minutes after, then on and off): that is not a green "live"
  if (l) { b.className = 'chip status' + (l.power ? ' on' : ''); b.innerHTML = `<span class="dot"></span>${l.power ? 'live' : 'smoker off'}`; return; }
  const last = S.cook ? S.readings[S.readings.length - 1] : S.last, now = Date.now();
  if (!last) { b.className = 'chip status'; b.innerHTML = '<span class="dot"></span>no reading yet'; return; }
  const fresh = now - last.at <= STALE_MINUTES * MINUTE;
  // With no cook nothing looks at the smoker on its own: an old reading is an old look, not an offline smoker.
  if (!S.cook) { b.className = 'chip status ' + (fresh ? 'on' : ''); b.innerHTML = `<span class="dot"></span>${fresh ? 'read ' : 'last read '}<span data-age="${last.at}" data-mode="${fresh ? 'ago' : 'clock'}">${fresh ? fmtAgo(last.at, now) : fmtStamp(last.at)}</span>`; return; }
  b.className = 'chip status ' + (fresh ? 'on' : 'off');
  b.innerHTML = `<span class="dot"></span>${fresh ? 'online, looked ' : 'offline since '}<span data-age="${last.at}" data-mode="${fresh ? 'ago' : 'clock'}">${fresh ? fmtAgo(last.at, now) : fmtStamp(last.at)}</span>`;
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

// ---- the stand-by: the smoker off, no session (his word 11-02: "when the smoker is off... a stand by screen") -------
// His own footage behind it (the loop in the notebook's private bucket, `tools/standby_clip.sh`), the state on top.
// Nothing moves but the video: the shade and the words are painted once, a live report patches the numbers in place,
// a tap or Select shows the page under it for a minute. It never shows during a session: that screen says "smoker off".
function standbyWanted(v) {
  if (STANDBY === false || !v || S.tab !== 'now' || S.cook || Date.now() < S.sbPeek) return false;
  if (STANDBY === true) return true;
  return S.mode === 'live' && !!(v.last && v.last.power === false);
}
function standbyReads(v) {
  const parts = [];
  if (v.pit.temp != null) parts.push(`Pit <b>${rnd(v.pit.temp)}°</b>`);
  for (const r of v.tiles) if (r.temp != null) parts.push(`${esc(capFirst(r.name))} <b>${rnd(r.temp)}°</b>`);
  return parts.join('<span class="sep">·</span>');
}
function standbySince() {
  if (!S.sbSince) return '';
  return Date.now() - S.sbSince < 20 * HOUR ? `since ${fmtClock(S.sbSince)}` : `since ${fmtDay(S.sbSince)}, ${fmtClock(S.sbSince)}`;
}
function standbyLast() {
  const h = S.sbLast; if (!h) return '';
  const name = h.meat ? capFirst(String(h.meat).replace(/_/g, ' ')) : (h.plan && h.plan.name) || 'Session';
  return `Last: ${esc(name)}, ${fmtDay(h.startedAt)} ${fmtClock(h.startedAt)}${h.endedAt ? ` – ${fmtClock(h.endedAt)}` : ''}`;
}
function standbyHTML(v) {
  const m = S.sbMedia || {};
  return `<section class="standby" tabindex="0" aria-label="The smoker is off. Select to see the page."${m.poster ? ` style="background-image:url(${m.poster})"` : ''}>
    <video class="sb-video" muted loop playsinline autoplay preload="auto"${m.poster ? ` poster="${m.poster}"` : ''}${m.video ? ` src="${m.video}"` : ''}></video>
    <div class="sb-shade"></div>
    <div class="sb-clock mono">${fmtClock(Date.now())}</div>
    <div class="sb-body">
      <div class="sb-state">Smoker off</div>
      <div class="sb-since dim">${standbySince()}</div>
      <div class="sb-reads mono">${standbyReads(v)}</div>
      <div class="sb-last dim">${standbyLast()}</div>
      <button type="button" class="btn sb-power" data-act="power">Power on</button>
    </div></section>`;
}
function patchStandby(v) {
  const set = (sel, html) => { const el = $(sel); if (el && el.innerHTML !== html) el.innerHTML = html; };
  set('#main .sb-reads', standbyReads(v)); set('#main .sb-since', standbySince()); set('#main .sb-last', standbyLast());
  set('#main .sb-clock', fmtClock(Date.now()));
}

// ---- Now ----------------------------------------------------------------------------------------------------
function nowHTML(v) {
  const c = v.cook, word = PHASE_WORD[v.phase] || 'Cooking';
  const sinceT = v.phase === 'cook' || v.phase === 'paused' ? c.startedAt : c.phaseAt || c.startedAt;
  const since = `${v.phase === 'cook' ? 'started' : word.toLowerCase() + ' since'} ${fmtClock(sinceT)}, ${fmtDur(v.elapsed / MINUTE)} in`;
  // One screen, plan or no plan: the Pit, its thermometers, the graph, the rest. The header is the plan's and goes with it.
  const head = v.hasPlan ? `<div class="phase"><h2><span class="tag ${v.phase}">${word}</span>${esc(v.plan.name)}</h2><div class="since">${esc(since)}</div></div>` : '';
  const n = v.tiles.length, meats = n ? `<div class="tiles${n > 1 ? ' many n' + Math.min(n, 4) : ''}">${v.tiles.map(r => meatHTML(r, v)).join('')}</div>` : '';
  const pit = pitHTML(v), asks = v.asks.map(askHTML).join('');
  const graph = graphHTML(v), log = logHTML(v.events, v.now, 6, c), sensors = sensorsHTML(v);
  const steps = v.hasPlan ? stepsHTML(v) : `<section class="steps"><h3>No plan running <button type="button" class="mini" data-act="go-plans">Run a plan</button>${c.idle ? '' : ' <button type="button" class="mini" data-act="points">Cooking points</button>'}</h3></section>`;
  // A new screen is the smoker now. Nothing of the last cook (his word 11-02): that lives in History.
  if (c.idle) return `<section class="now idle">${pit}${meats}${steps}${sensors}</section>`;
  if (wideScreen()) return `<section class="now">${head}<div class="left">${pit}${meats}${asks}${steps}${sensors}</div><div class="rightcol">${graph}${log}</div></section>`;
  return `<section class="now">${head}${pit}${meats}${asks}${graph}${steps}${log}${sensors}</section>`;
}
function meatHTML(r, v) {
  const temp = r.temp == null ? '<div class="temp none">not reading</div>' : `<div class="temp${r.stale ? ' stale' : ''}">${rnd(r.temp)}<sup>°F</sup></div>`;
  let line = '';
  if (v.cook.idle) line = '';
  else if (r.resting) line = '<div class="line resting">resting, I tell you at <b>160</b></div>';
  else if (v.phase === 'hold' || (v.phase === 'rest' && r.ended && !r.resting)) line = `<div class="line">${v.phase === 'hold' ? 'holding, watched for <b>140</b>' : 'off the smoker'}</div>`;
  else if (r.ended) line = `<div class="line dim">${esc(r.step && r.step.name || 'off the smoker')}</div>`;
  else if (r.until) line = `<div class="line">${r.until.html}</div>`;
  else if (r.step) line = `<div class="line dim">${esc(r.step.name || 'waits for you')}</div>`;
  else if (r.mark) line = `<div class="line">tell me at <b>${r.mark.at}</b></div>`;
  else line = '<div class="line dim">no target, just watched</div>';
  const mark = r.mark && (r.until || r.step) && !v.cook.idle ? `<div class="pace">tell me at <b>${r.mark.at}</b></div>` : '';
  const rate = r.rate == null ? '' : `<div class="rate${r.stalled ? ' stall' : ''}">${r.stalled ? 'the stall, ' : ''}${r.rate >= 0 ? '+' : '−'}${Math.abs(r.rate).toFixed(Math.abs(r.rate) >= 10 ? 0 : 1)}°/h</div>`;
  const pace = r.pace ? `<div class="pace">at this pace, ${r.pace.value} around <b>${fmtClock(r.pace.at)}</b></div>` : '';
  const track = r.steps.length > 1 && r.track ? `<div class="track">${r.steps.map((s, i) => `<span class="${i < r.track.step ? 'done' : i === r.track.step ? 'cur' : ''}">${esc(s.name || 'step ' + (i + 1))}</span>`).join('')}</div>` : '<div></div>';
  const age = r.live ? '<span class="age">live</span>' : r.tempAt ? `<span class="age${r.stale ? ' stale' : ''}">${r.stale ? 'last read ' + fmtClock(r.tempAt) : `<span data-age="${r.tempAt}">${fmtAgo(r.tempAt, v.now)}</span>`}</span>` : '';
  const tap = !v.cook.idle && !v.cook.endedAt ? ` role="button" tabindex="0" aria-label="${esc(capFirst(r.name))}: name it, or tell me at" data-act="tile" data-v="${esc(r.pid)}"` : '';
  return `<article class="meat" style="--c:${r.color}" data-pid="${esc(r.pid)}"${tap}>
    <div class="head"><div class="role">${esc(r.name)}${r.step && r.step.name && r.steps.length > 1 ? `<span class="stepname">, ${esc(r.step.name)}</span>` : ''}</div>${age}</div>
    <div class="big">${temp}<div class="right">${line}${rate}${pace}${mark}</div></div>
    ${v.cook.idle ? '' : `<div class="foot">${track}<canvas class="spark" data-pid="${esc(r.pid)}" width="192" height="60" aria-hidden="true"></canvas></div>`}</article>`;
}
function pitHTML(v) {
  const p = v.pit, c = v.cook;
  const temp = p.temp == null ? '<div class="temp none">no reading</div>' : `<div class="temp">${rnd(p.temp)}<sup>°F</sup></div>`;
  const heat = v.last && v.last.power === false ? '<div class="heat">smoker off</div>' : `<div class="heat${p.heating ? ' on' : ''}">${p.heating ? 'heating' : 'holding'}</div>`;
  let line = '';
  if (!v.hasPlan) line = c.idle ? '' : `<div class="next">On since <b>${fmtClock(c.startedAt)}</b>, ${fmtDur(v.elapsed / MINUTE)}</div>`;
  else if ((v.phase === 'cook' || v.phase === 'paused') && p.step) {
    const s = p.step, last = p.idx === p.steps.length - 1;
    line = `<div class="next"><b>${esc(s.name || 'Step ' + (p.idx + 1))}</b>${typeof s.set === 'number' ? `, pit at ${s.set}` : ''}${p.until ? ', ' + p.until.html : last ? '. The last step: tap Cook done when the meat is off' : ''}${p.next ? ` <span class="dim">then ${esc(p.next.name || 'the next step')}${typeof p.next.set === 'number' ? ` at ${p.next.set}` : ''}</span>` : ''}</div>`;
  } else if (v.phase === 'rest') line = `<div class="next">Cook done. ${p.set != null && p.set >= (c.restSet || 150) ? `The pit sits at <b>${c.restSet || 150}</b> for the hold.` : 'The pit is left as it is.'}</div>`;
  else if (v.phase === 'hold') line = `<div class="next">Holding at <b>${c.restSet || 150}</b>. The meat is watched for 140.</div>`;
  const pending = c.pending ? `<div class="pending">Sent ${c.pending.set}°F, waiting for the smoker to take it</div>` : c.failed ? `<div class="pending">The smoker didn't take ${c.failed.set}°F</div>` : '';
  const looked = v.last && v.last.live ? (v.last.power === false ? '<span class="live off"><i></i>off</span>' : '<span class="live"><i></i>live</span>') : v.sensors.lastHeard ? (v.sensors.online ? `looked <span data-age="${v.sensors.lastHeard}">${fmtAgo(v.sensors.lastHeard, v.now)}</span>` : c.idle ? `last read ${fmtStamp(v.sensors.lastHeard)}` : `offline since ${fmtClock(v.sensors.lastHeard)}`) : 'no reading yet';
  const live = c.idle || (!c.endedAt && c.status !== 'done' && c.status !== 'stopped' && !(S.mode === 'demo' && c.status !== 'running'));
  const set = live ? `<button type="button" class="set-temp" data-act="set-pit">Set temp${p.set ? ` <b>${p.set}</b>` : ''}</button>` : p.set ? `<div class="set">set <b>${p.set}</b></div>` : '<div class="set dim">no setpoint</div>';
  const timers = (v.timers || []).filter(t => !t.told || v.now - t.at < 2 * HOUR).slice(-3).map(t => t.told ? `<span class="tm done">${esc(t.name)}: up at ${fmtClock(t.at)}</span>` : `<span class="tm"><b>${esc(t.name)}</b> ${fmtDur(t.left)} left, ${fmtClock(t.at)}</span>`).join('');
  const tools = live && !c.idle ? `<div class="pit-tools">${timers}<button type="button" class="mini" data-act="timer">Set timer</button></div>` : timers ? `<div class="pit-tools">${timers}</div>` : '';
  return `<article class="pit"><div class="head"><div class="role">Pit</div><div class="stepname">${looked}</div></div><div class="big">${temp}<div class="right">${set}${heat}</div></div>${line}${pending}${tools}</article>`;
}
function askHTML(a) {
  return `<article class="ask"><div class="when">${fmtClock(a.at)}</div><p>${esc(a.text)}</p>
    <div class="two"><button class="btn" data-act="answer" data-v="${esc(a.ask[0])}">${esc(a.ask[0])}</button><button class="btn" data-act="answer" data-v="${esc(a.ask[1])}">${esc(a.ask[1])}</button></div></article>`;
}
function legendHTML(v) {
  const items = [{ key: 'pit', label: 'Pit', color: PIT_COLOR }, { key: 'set', label: 'Setpoint', color: PIT_COLOR, dash: true }].concat(v.lines.map(r => ({ key: r.pid, label: capFirst(r.name), color: r.color })));
  return `<div class="legend">${items.map(i => `<button type="button" data-act="legend" data-v="${esc(i.key)}" class="${S.hidden[i.key] ? 'off' : ''}" style="--c:${i.color}" aria-pressed="${!S.hidden[i.key]}"><span class="key${i.dash ? ' dash' : ''}"></span>${esc(i.label)}</button>`).join('')}</div>`;
}
function graphHTML(v) {
  if (!readingsOf(v).length) return '<section class="graph"><div class="empty">No readings yet. The first look draws the first point.</div></section>';
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
    <div class="row">${S.cook && !S.cook.endedAt && S.cook.phase === 'cook' && !(S.mode === 'demo' && S.cook.status !== 'running') ? `<button type="button" class="btn primary" data-act="use-plan" data-v="${esc(r.id)}">${S.cook.auto || S.cook.plan.name === 'Just watch' ? 'Run this plan' : 'Use on the running cook'}</button>` : `<button type="button" class="btn primary" data-act="start-plan" data-v="${esc(r.id)}">Run this plan</button>`}</div>
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
  if (!v || S.tab === 'now' || v.cook.idle || v.cook.endedAt || (S.mode === 'demo' && v.cook.status !== 'running')) { s.hidden = true; return; }
  s.hidden = false;
  s.innerHTML = `<span class="ph">${PHASE_WORD[v.phase] || 'Cooking'}</span><span class="v"><span class="key" style="background:${PIT_COLOR}"></span><span class="n">${v.pit.temp == null ? '—' : rnd(v.pit.temp) + '°'}</span><span class="k">pit${v.pit.set ? ' / ' + v.pit.set : ''}</span></span>${v.tiles.map(r => `<span class="v"><span class="key" style="background:${r.color}"></span><span class="n">${r.temp == null ? '—' : rnd(r.temp) + '°'}</span><span class="k">${esc(r.name)}</span></span>`).join('')}<span class="go">Now ›</span>`;
}
function renderActions(v) {
  const a = $('#actions'); if (!a) return;
  if (!v || S.tab !== 'now' || S.sbOn) { a.hidden = true; return; }   // the stand-by carries its own Power on
  if (v.cook.idle) { const l = v.last; a.hidden = false; a.className = 'actions three'; a.innerHTML = `<button type="button" class="btn" data-act="read-now">Read now</button><button type="button" class="btn" data-act="set">Set pit</button><button type="button" class="btn" data-act="power">${l ? (l.power ? 'Power off' : 'Power on') : 'Power'}</button>`; return; }
  if (v.cook.endedAt || v.cook.status === 'done' || v.cook.status === 'stopped') { a.hidden = true; return; }
  a.hidden = false;
  const paused = v.cook.status === 'paused';
  if (!v.hasPlan) {
    // A session: End leaves the smoker as it is. Cook done only when the pit is set above the hold, so it has something
    // to lower (a cook he runs by hand); on a cold or idle pit it did nothing but raise it (11-03).
    const hot = !!(v.last && v.last.power !== false && v.pit.set != null && v.pit.set > (v.last.range ? v.last.range.min : 150));
    a.className = hot ? 'actions three' : 'actions two';
    a.innerHTML = `<button type="button" class="btn" data-act="set">Set pit</button>${hot ? '<button type="button" class="btn" data-act="done">Cook done</button>' : ''}<button type="button" class="btn primary" data-act="end">End session</button>`;
  }
  else if (v.phase === 'cook' || v.phase === 'paused') { a.className = 'actions'; a.innerHTML = `<button type="button" class="btn" data-act="set">Set pit</button><button type="button" class="btn" data-act="next">Next step</button><button type="button" class="btn" data-act="${paused ? 'resume' : 'pause'}">${paused ? 'Resume' : 'Pause'}</button><button type="button" class="btn primary" data-act="done">Cook done</button>`; }
  else if (v.phase === 'rest') { a.className = 'actions three'; a.innerHTML = '<button type="button" class="btn" data-act="set">Set pit</button><button type="button" class="btn" data-act="rested">Rested</button><button type="button" class="btn primary" data-act="end">End cook</button>'; }
  else { a.className = 'actions two'; a.innerHTML = '<button type="button" class="btn" data-act="set">Set pit</button><button type="button" class="btn primary" data-act="end">End cook</button>'; }
}

// ---- after the HTML is in: the canvases, lazy loads, the ages ---------------------------------------------------
function afterRender(v) {
  if (S.chart) { S.chart.destroy(); S.chart = null; }
  const sbEl = $('#main .standby');
  if (sbEl) {   // a tap or Select on the stand-by shows the page under it for a minute; Power on is its own button
    sbEl.addEventListener('click', e => { if (!e.target.closest('[data-act="power"]')) peekStandby(); });
    sbEl.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === sbEl) { e.preventDefault(); peekStandby(); } });
    const vid = $('video', sbEl); if (vid && vid.src) vid.play().catch(() => {});
  }
  const host = $('#chart');
  if (host && S.view) { S.chart = new PitChart(host, { zoom: false }); S.chart.setData(chartDataOf(S.view)); }
  if (S.view) for (const c of $$('canvas.spark')) { const r = S.view.roles.find(x => x.pid === c.dataset.pid); if (r) drawSpark(c, r.spark.length > 1 ? r.spark : r.pts.slice(-30), r.color); }
  for (const c of $$('canvas[data-thumb]')) {
    const id = c.dataset.thumb, data = S.histData[id], cook = S.history.find(h => h.id === id);
    if (data) drawThumb(c, data.readings, cook && cook.probes); else loadHistData(id).then(() => { if (document.body.contains(c) && S.histData[id]) drawThumb(c, S.histData[id].readings, cook && cook.probes); });
  }
  if (S.tab === 'history' && S.sub && !S.histData[S.sub]) loadHistData(S.sub).then(() => renderAll());
}
function tickAges() {
  const now = S.now();
  const clock = $('#main .sb-clock'); if (clock) clock.textContent = fmtClock(Date.now());
  for (const el of $$('[data-age]')) { const t = +el.dataset.age; el.textContent = el.dataset.mode === 'clock' ? fmtStamp(t) : fmtAgo(t, S.mode === 'demo' ? now : Date.now()); }
}

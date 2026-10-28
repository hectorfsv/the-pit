/* The Pit — what he does: the sheets (one sheet for every order: what you're asking, hold to send, the answer), the
   orders themselves (a row in the notebook, then the doorbell), the plan editor, the full graph, the switches. */
'use strict';
const ACTION_WORDS = { set: v => `Set the pit to ${v}°F`, next: () => 'Next step', pause: () => 'Pause the plan', resume: () => 'Back to the plan', done: () => 'Cook done', rested: () => 'Rested',
  end: () => 'End the cook', answer: v => `“${v}”`, power: v => v ? 'Power on' : 'Power off', read: () => 'Read the smoker', start: () => 'Start the cook', save_plan: () => 'Save the plan',
  archive_plan: () => 'Archive the plan', note: () => 'Save the note', rate: () => 'Rate the cook', units_f: () => 'Switch the smoker to °F', keep: () => 'Keep it', retry: () => 'Try again' };
const describeOrder = (a, v) => (ACTION_WORDS[a] || (() => a))(v);

// ---- toasts ---------------------------------------------------------------------------------------------------
function toast(text, kind, ttl) {
  const el = document.createElement('div'); el.className = 'toast ' + (kind || '');
  const set = (t, k) => { el.textContent = t; if (k) el.className = 'toast ' + k; };
  set(text, kind); $('#toasts').appendChild(el); requestAnimationFrame(() => el.classList.add('in'));
  let timer = null;
  const close = () => { el.classList.remove('in'); setTimeout(() => el.remove(), 250); };
  const arm = ms => { clearTimeout(timer); if (ms) timer = setTimeout(close, ms); };
  arm(ttl === undefined ? 4500 : ttl);
  el.addEventListener('click', close);
  return { el, update(t, k, ms) { set(t, k); arm(ms === undefined ? 6000 : ms); }, close };
}

// ---- sheets ---------------------------------------------------------------------------------------------------
function openSheet(o) {
  closeSheet();
  const ov = document.createElement('div'); ov.className = 'overlay';
  ov.innerHTML = `<div class="sheet${o.full ? ' full' : ''}" role="dialog" aria-modal="true" aria-label="${esc(o.title || '')}"><div class="grab"></div>${o.title ? `<h2>${esc(o.title)}</h2>` : ''}${o.sub ? `<p class="sub">${o.sub}</p>` : ''}<div class="body">${o.body || ''}</div><div class="foot">${o.foot || ''}</div></div>`;
  ov.addEventListener('click', e => { if (e.target === ov) closeSheet(); });
  $('#sheet-root').appendChild(ov); requestAnimationFrame(() => ov.classList.add('in'));
  const esc_ = e => { if (e.key === 'Escape') closeSheet(); }; document.addEventListener('keydown', esc_); ov._esc = esc_;
  const sheet = ov.querySelector('.sheet');
  if (o.onOpen) o.onOpen(sheet);
  return sheet;
}
function closeSheet() { const ov = $('#sheet-root .overlay'); if (!ov) return; document.removeEventListener('keydown', ov._esc); ov.classList.remove('in'); setTimeout(() => ov.remove(), 200); }
// Hold 1.1 s to fire: the bar fills (transform only); let go early and nothing happens.
function armHold(btn, fn) {
  if (!btn || btn._armed) return; btn._armed = true;
  btn.classList.add('hold'); if (!btn.querySelector('.fill')) { const f = document.createElement('span'); f.className = 'fill'; btn.prepend(f); }
  let timer = null;
  const start = e => { if (btn.disabled || timer) return; if (e.type === 'pointerdown') e.preventDefault(); btn.classList.add('arming'); timer = setTimeout(() => { timer = null; btn.classList.remove('arming'); btn.classList.add('fired'); setTimeout(() => btn.classList.remove('fired'), 500); fn(); }, 1100); };
  const stop = () => { if (timer) { clearTimeout(timer); timer = null; } btn.classList.remove('arming'); };
  btn.addEventListener('pointerdown', start); ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => btn.addEventListener(t, stop));
  btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); start(e); } }); btn.addEventListener('keyup', stop);
  btn.addEventListener('click', e => e.preventDefault()); btn.addEventListener('contextmenu', e => e.preventDefault());
  btn.style.webkitUserSelect = 'none'; btn.style.webkitTouchCallout = 'none'; btn.style.userSelect = 'none';
}
const holdFoot = (label, cls) => `<button type="button" class="btn ${cls || 'primary'}" id="sheet-go"><span class="lbl">${esc(label)}</span></button><div class="hold-hint">hold to confirm</div>`;
function confirmSheet(o) {
  openSheet({ title: o.title, sub: o.sub, body: o.body || '', foot: holdFoot(o.label, o.cls) + (o.cancel === false ? '' : '<button type="button" class="btn quiet" id="sheet-no">Not now</button>'),
    onOpen: sh => { const go = $('#sheet-go', sh); if (o.disabled) go.disabled = true; armHold(go, () => { closeSheet(); o.onFire(); }); const no = $('#sheet-no', sh); if (no) no.addEventListener('click', closeSheet); if (o.onOpen) o.onOpen(sh); } });
}

// ---- orders ---------------------------------------------------------------------------------------------------
async function placeOrder(action, value, opts) {
  opts = opts || {};
  if (S.mode === 'demo') { toast(`Sample cook: nothing is sent. ${describeOrder(action, value)}.`, 'wait'); return null; }
  if (!S.pit) { toast('No pit in the notebook yet.', 'bad'); return null; }
  const live = S.cook && !S.cook.endedAt && (S.cook.status === 'running' || S.cook.status === 'paused');
  const row = { pit_id: S.pit.id, cook_id: opts.cookId || (live ? S.cook.id : null), action, value: value === undefined ? null : value };
  let inserted;
  try { inserted = (await sb.insert('orders', row))[0]; } catch (e) { toast('Could not write the order: ' + e.message, 'bad'); return null; }
  S.orders.push({ id: inserted.id, action, value, at: Date.now(), status: 'waiting' });
  const t = toast(`${describeOrder(action, value)}: waiting for the engine…`, 'wait', 0);
  try {
    if (live && S.cook.runnerUrl) await fetch(S.cook.runnerUrl, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ order_id: inserted.id }) });
    else if (CFG.doorUrl) await fetch(`${CFG.doorUrl}?order_id=${encodeURIComponent(inserted.id)}`, { method: 'POST', mode: 'no-cors' });
  } catch (e) { /* the engine's next look picks the order up anyway */ }
  fastPoll(90);
  const t0 = Date.now();
  const watch = async () => {
    try {
      const rows = await sb.get(`orders?id=eq.${inserted.id}&select=status,result`), o = rows && rows[0];
      if (o && o.status !== 'waiting') {
        const mine = S.orders.find(x => x.id === inserted.id); if (mine) mine.status = o.status;
        const errs = o.result && o.result.errors && o.result.errors.length ? o.result.errors.join(' ') : '';
        t.update(o.status === 'done' ? `${describeOrder(action, value)}: the engine took it.${errs ? ' ' + errs : ''}` : o.status === 'refused' ? `Not done: ${errs || 'the engine refused it.'}` : 'That order expired before the engine saw it. Nothing was sent late.', o.status === 'done' ? 'good' : 'bad');
        refreshLive(); if (opts.after) opts.after(o); return;
      }
    } catch (e) { /* try again */ }
    if (Date.now() - t0 > 5 * MINUTE) { t.update('No answer in 5 minutes: the engine did not pick this up. Nothing is sent late.', 'bad', 10000); return; }
    setTimeout(watch, Date.now() - t0 < 30000 ? 2000 : 5000);
  };
  setTimeout(watch, 1500);
  return inserted;
}

// ---- the sheets for each action ---------------------------------------------------------------------------------
function refusals(last) {
  const now = S.now(), out = [];
  if (!last) out.push("I can't read the smoker right now.");
  else { if (now - last.at > STALE_MINUTES * MINUTE) out.push('The smoker is offline.'); if (!last.power) out.push('The smoker is off. Turn it on and light it first.'); if (!last.fah) out.push('The smoker is set to °C. Switch it to °F first.'); }
  return out;
}
function openSetPit() {
  const v = S.view, last = v ? v.last : S.last, range = (last && last.range) || { min: S.pit ? S.pit.range_min : 150, max: S.pit ? S.pit.range_max : 700 };
  let val = (last && last.set) || 225; const bad = refusals(last).filter(r => !/off\./.test(r));
  const presets = [150, 200, 225, 250, 275, 300, 325];
  const paint = sh => { $('.stepper .val', sh).innerHTML = `${val}<sup>°F</sup>`; $$('.presets button', sh).forEach(b => b.classList.toggle('on', +b.dataset.v === val)); $('#sheet-go .lbl', sh).textContent = `Set the pit to ${val}°F`; };
  confirmSheet({ title: 'Set the pit', sub: `The smoker goes from ${range.min} to ${range.max}°F. Your setpoint stands until the plan's next step sets its own.`, label: `Set the pit to ${val}°F`, disabled: bad.length > 0,
    body: `<div class="stepper"><button type="button" data-d="-5" aria-label="5 less">−</button><div class="val"></div><button type="button" data-d="5" aria-label="5 more">+</button></div><div class="presets">${presets.map(p => `<button type="button" data-v="${p}">${p}</button>`).join('')}</div>${bad.length ? `<p class="refuse">${esc(bad.join(' '))}</p>` : ''}`,
    onOpen: sh => { paint(sh); $$('.stepper button', sh).forEach(b => b.addEventListener('click', () => { val = Math.min(range.max, Math.max(range.min, val + +b.dataset.d)); paint(sh); })); $$('.presets button', sh).forEach(b => b.addEventListener('click', () => { val = +b.dataset.v; paint(sh); })); },
    onFire: () => placeOrder('set', val) });
}
function openNext() {
  const v = S.view; if (!v) return;
  const tracks = Object.entries(v.cook.tracks).filter(([role, st]) => !st.ended && (v.plan.tracks[role] || []).length > st.step + 1).map(([role, st]) => ({ role, from: v.plan.tracks[role][st.step], to: v.plan.tracks[role][st.step + 1] }));
  if (!tracks.length) { toast('Every track is on its last step. Tap Cook done when the meat is off.', 'wait'); return; }
  let pick = tracks[0].role;
  const body = tracks.length === 1 ? `<p class="note">${esc(capFirst(tracks[0].role))}: from <b>${esc(tracks[0].from.name || 'this step')}</b> to <b>${esc(tracks[0].to.name || 'the next step')}</b>${typeof tracks[0].to.set === 'number' ? `, pit to ${tracks[0].to.set}°F` : ''}.</p>`
    : `<div class="radio-list">${tracks.map((t, i) => `<label class="${i === 0 ? 'on' : ''}"><input type="radio" name="trk" value="${esc(t.role)}"${i === 0 ? ' checked' : ''}><span><span class="t">${esc(capFirst(t.role))}</span><div class="d">${esc(t.from.name || 'this step')} → ${esc(t.to.name || 'next')}${typeof t.to.set === 'number' ? `, pit to ${t.to.set}°F` : ''}</div></span></label>`).join('')}</div>`;
  confirmSheet({ title: 'Next step', sub: 'The engine would get here on its own; this moves it now.', body, label: 'Go to the next step',
    onOpen: sh => $$('input[name=trk]', sh).forEach(r => r.addEventListener('change', () => { pick = r.value; $$('.radio-list label', sh).forEach(l => l.classList.toggle('on', l.contains(r))); })),
    onFire: () => placeOrder('next', pick === 'pit' ? undefined : pick) });
}
function openDone() {
  const v = S.view, meats = v ? v.roles.filter(r => r.temp != null).map(r => r.role) : [];
  confirmSheet({ title: 'Cook done', sub: `The pit drops to ${v && v.last && v.last.range ? v.last.range.min : 150}°F for the hold. ${meats.length ? `The ${meats.join(' and the ')} rest off the smoker; I tell you at 160.` : 'Tap Rested when the meat is down to 160–155.'} Then the hold, as long as you can.`, label: 'Cook done', onFire: () => placeOrder('done') });
}
function openRested() { confirmSheet({ title: 'Rested', sub: 'The meat is down to 160–155. Back in the smoker or the oven at 150: the hold begins and I watch for 140.', label: 'Rested, start the hold', onFire: () => placeOrder('rested') }); }
function openEnd() { confirmSheet({ title: 'End the cook', sub: 'The cook closes and goes to History. The smoker is left as it is.', label: 'End the cook', cls: 'danger', onFire: () => placeOrder('end') }); }
function openResume() { confirmSheet({ title: 'Back to the plan', sub: "The plan's setpoint goes to the smoker again and the steps move on.", label: 'Resume the plan', onFire: () => placeOrder('resume') }); }
function openPower() {
  const last = S.view ? S.view.last : S.last, on = !(last && last.power === false);
  confirmSheet({ title: on ? 'Turn the smoker off' : 'Turn the smoker on', sub: on ? 'Same as the power button on the smoker. A running cook is told the smoker is off and asks what to do.' : 'The smoker powers on. You still light it.', label: on ? 'Power off' : 'Power on', cls: on ? 'danger' : 'primary', onFire: () => placeOrder('power', !on) });
}
function openReadNow() { placeOrder('read'); }
// ---- the basic start (his ask 10-28): the smoker big, set temp, a timer, each probe's meat and its own temperature,
//      and the cooking points: "when the meat hits X, smoker to Y". No plan to pick; plans have their own tab. ----------
const TIMER_PRESETS = [0, 30, 45, 60, 90, 120], TEMP_PRESETS = [0, 200, 225, 250, 275, 300, 325];
function smokerNowHTML(last) {
  if (!last) return '<div class="nowbox"><div class="k">The smoker now</div><div class="dim">no reading yet</div></div>';
  const probes = probeSources().map(p => `<span>${esc(p.label)} <b>${last.probes && last.probes[p.id] != null ? rnd(last.probes[p.id]) + '°' : '—'}</b></span>`).join('');
  return `<div class="nowbox"><div class="k">The smoker now, looked <span data-age="${last.at}">${fmtAgo(last.at, S.now())}</span></div><div class="big">${last.pit == null ? '—' : rnd(last.pit) + '°'}<span>${last.set ? `set ${last.set}` : 'no setpoint'}${last.heating ? ', heating' : ''}</span></div><div class="pnow">${probes}</div></div>`;
}
function presetsHTML(name, values, current, unit, zero) {
  return `<div class="presets" data-presets="${name}">${values.map(v => `<button type="button" data-v="${v}" class="${(current || 0) === v ? 'on' : ''}">${v === 0 ? zero : v + unit}</button>`).join('')}</div>`;
}
function openNewCook() {
  const last = S.last || (S.view && S.view.last) || null;
  const st = { setTemp: last && last.set >= 150 ? last.set : 225, timer: 0, meats: probeSources().map(p => ({ probe: p.id, label: p.label, name: '', target: '' })), points: [], follow: '' };
  const named = () => st.meats.filter(m => slugRole(m.name));
  const body = () => {
    const plan = composePlan(st), bad = refusals(last).concat(plan.errors);
    return `${smokerNowHTML(last)}
      <section class="bs"><h4>Set the pit</h4>${presetsHTML('temp', TEMP_PRESETS, st.setTemp, '', 'leave it')}<div class="stepper small"><button type="button" data-d="-5" aria-label="5 less">−</button><div class="val">${st.setTemp ? `${st.setTemp}<sup>°F</sup>` : '<span class="leave">as it is</span>'}</div><button type="button" data-d="5" aria-label="5 more">+</button></div></section>
      <section class="bs"><h4>The meats</h4><div class="note">Name the meat on each probe and the temperature to tell you at. Each one tells you on its own.</div>
        <div class="mrows">${st.meats.map((m, i) => `<div class="mrow"><span class="pl">${esc(m.label)}<b>${last && last.probes && last.probes[m.probe] != null ? rnd(last.probes[m.probe]) + '°' : '—'}</b></span><label class="field"><input data-m="${i}" data-k="name" placeholder="${['chicken', 'pork', 'beef', 'links'][i % 4]}" value="${esc(m.name)}" autocapitalize="none"></label><label class="field"><input data-m="${i}" data-k="target" type="number" inputmode="numeric" placeholder="°F" value="${m.target}"></label></div>`).join('')}</div></section>
      <section class="bs"><h4>Cooking points</h4><div class="note">When a meat reaches a temperature, the smoker goes to another. The app makes the changes.</div>
        ${named().length ? `<label class="field"><span>Follow</span><select id="follow">${named().map(m => `<option value="${esc(m.name)}"${slugRole(m.name) === slugRole(st.follow) ? ' selected' : ''}>${esc(m.name)} (${esc(m.label)})</option>`).join('')}</select></label>` : '<div class="dim" style="font-size:13px">Name a meat above first.</div>'}
        <div class="prows">${st.points.map((pt, i) => `<div class="prow"><span>when it hits</span><label class="field"><input data-p="${i}" data-k="at" type="number" inputmode="numeric" placeholder="165" value="${pt.at}"></label><span>smoker to</span><label class="field"><input data-p="${i}" data-k="set" type="number" inputmode="numeric" placeholder="250" value="${pt.set}"></label><button type="button" data-delp="${i}" aria-label="Remove">×</button></div>`).join('')}</div>
        <button type="button" class="add" id="add-point">Add a point</button></section>
      <details class="bs sub"${st.timer ? ' open' : ''}><summary>Timer<span class="dim">${st.timer ? `${st.timer} min` : 'optional'}</span></summary><div class="note">Counts on the screen; your Jarvis chat gets told when it's up.</div>${presetsHTML('timer', TIMER_PRESETS, st.timer, ' min', 'none')}<label class="field"><span>Or minutes</span><input id="timer-min" type="number" inputmode="numeric" min="1" value="${st.timer && !TIMER_PRESETS.includes(st.timer) ? st.timer : ''}" placeholder="75"></label></details>
      <div id="start-check">${bad.length ? `<p class="refuse">${esc(bad.join(' '))}</p>` : `<p class="okay">Ready: ${esc(plan.plan.name)}${named().length ? ', ' + named().map(m => m.name + (m.target ? ' to ' + m.target : '')).join(', ') : ''}${st.timer ? `, a ${st.timer}-minute timer` : ''}.</p>`}</div>`;
  };
  const check = sh => { const plan = composePlan(st), bad = refusals(last).concat(plan.errors); $('#start-check', sh).innerHTML = bad.length ? `<p class="refuse">${esc(bad.join(' '))}</p>` : `<p class="okay">Ready: ${esc(plan.plan.name)}.</p>`; $('#sheet-go', sh).disabled = bad.length > 0; };
  const wire = sh => {
    $$('[data-presets=temp] button', sh).forEach(b => b.addEventListener('click', () => { st.setTemp = +b.dataset.v; redraw(sh); }));
    $$('.stepper button', sh).forEach(b => b.addEventListener('click', () => { st.setTemp = Math.min(700, Math.max(150, (st.setTemp || 220) + +b.dataset.d)); redraw(sh); }));
    $$('[data-presets=timer] button', sh).forEach(b => b.addEventListener('click', () => { st.timer = +b.dataset.v; redraw(sh); }));
    $('#timer-min', sh).addEventListener('input', e => { st.timer = +e.target.value || 0; $$('[data-presets=timer] button', sh).forEach(x => x.classList.toggle('on', +x.dataset.v === st.timer)); check(sh); });
    $$('[data-m]', sh).forEach(el => el.addEventListener('input', () => { st.meats[+el.dataset.m][el.dataset.k] = el.value; if (el.dataset.k === 'name') { if (!st.follow || !named().some(m => slugRole(m.name) === slugRole(st.follow))) st.follow = named()[0] ? named()[0].name : ''; const f = $('#follow', sh); if (!f || named().length !== f.options.length) { const keep = document.activeElement === el ? [el.dataset.m, el.selectionStart] : null; redraw(sh); if (keep) { const again = $(`[data-m="${keep[0]}"][data-k=name]`, sh); if (again) { again.focus(); try { again.setSelectionRange(keep[1], keep[1]); } catch (e) { /* number fields */ } } } return; } } check(sh); }));
    const f = $('#follow', sh); if (f) f.addEventListener('change', () => { st.follow = f.value; check(sh); });
    $$('[data-p]', sh).forEach(el => el.addEventListener('input', () => { st.points[+el.dataset.p][el.dataset.k] = el.value; check(sh); }));
    $$('[data-delp]', sh).forEach(b => b.addEventListener('click', () => { st.points.splice(+b.dataset.delp, 1); redraw(sh); }));
    $('#add-point', sh).addEventListener('click', () => { if (!st.follow && named()[0]) st.follow = named()[0].name; st.points.push({ at: '', set: '' }); redraw(sh); setTimeout(() => { const last = $$('[data-p][data-k=at]', sh).pop(); if (last) last.focus(); }, 50); });
    check(sh);
  };
  const redraw = sh => { const y = sh.scrollTop; $('.body', sh).innerHTML = body(); wire(sh); sh.scrollTop = y; };
  confirmSheet({ title: 'Start a cook', sub: 'The basics. A plan is for "set the meat and go": pick one on the Plans tab, now or while this cook runs.', body: body(), label: 'Start the cook', full: true, disabled: true,
    onOpen: wire,
    onFire: () => { const plan = composePlan(st); if (plan.errors.length) return; const value = { plan: plan.plan, probes: plan.probes }; if (st.timer) value.tells = [{ name: 'timer', minutes: st.timer }]; placeOrder('start', value, { cookId: null }); } });
}
// A plan from the Plans tab: which probe is in which of its meats, then Start, or use it on the running cook.
function assignHTML(row, current) {
  const src = probeSources(), last = S.last || (S.view && S.view.last) || null;
  return `<div class="assign">${(row.plan.probes || []).map((r, i) => `<div class="a"><div class="r" style="--c:${MEAT_COLORS[i % 4]}"><i></i>${esc(r)}</div><label class="field"><select data-role="${esc(r)}"><option value="">no probe</option>${src.map((p, j) => `<option value="${esc(p.id)}"${(current && current[r] === p.id) || (!(current && current[r]) && j === i) ? ' selected' : ''}>${esc(p.label)}${last && last.probes && last.probes[p.id] != null ? `, ${rnd(last.probes[p.id])}°` : ''}</option>`).join('')}</select></label></div>`).join('')}</div>`;
}
const readAssign = sh => { const probes = {}; $$('select[data-role]', sh).forEach(x => { if (x.value) probes[x.dataset.role] = x.value; }); return probes; };
function openStartPlan(row) {
  if (!row) return;
  const last = S.last || (S.view && S.view.last) || null; let timer = 0;
  confirmSheet({ title: `Start: ${row.plan.name}`, sub: planSummary(row.plan), label: 'Start the cook', full: true, disabled: refusals(last).length > 0,
    body: `${smokerNowHTML(last)}${(row.plan.probes || []).length ? `<div class="note">Which probe is in which meat?</div>${assignHTML(row)}` : ''}<details class="bs sub"><summary>Timer<span class="dim">optional</span></summary>${presetsHTML('timer', TIMER_PRESETS, 0, ' min', 'none')}</details>${refusals(last).length ? `<p class="refuse">${esc(refusals(last).join(' '))}</p>` : '<p class="okay">The smoker is on, in °F and online. The plan freezes as it is now.</p>'}`,
    onOpen: sh => $$('[data-presets=timer] button', sh).forEach(b => b.addEventListener('click', () => { timer = +b.dataset.v; $$('[data-presets=timer] button', sh).forEach(x => x.classList.toggle('on', x === b)); })),
    onFire: () => { const value = { plan_id: row.id, plan: row.plan, probes: readAssign(document) }; if (timer) value.tells = [{ name: 'timer', minutes: timer }]; placeOrder('start', value, { cookId: null }); } });
}
function openUsePlan(row) {
  const v = S.view; if (!row || !v) return;
  confirmSheet({ title: `Use on the running cook: ${row.plan.name}`, sub: 'Its pit steps take over from the first one now. The meats this cook already has keep their own lines.', label: 'Use this plan now',
    body: `${(row.plan.probes || []).length ? `<div class="note">Which probe is in which of its meats?</div>${assignHTML(row, v.cook.probes)}` : ''}<div class="note">${esc(planSummary(row.plan).replace(/<[^>]+>/g, ''))}</div>`,
    onFire: () => placeOrder('plan', { plan_id: row.id, plan: row.plan, probes: readAssign(document) }) });
}
function openPoints() {
  const v = S.view; if (!v || v.phase !== 'cook' && v.phase !== 'paused') return;
  const roles = v.roles.map(r => r.role); if (!roles.length) { toast('Name a meat on a probe first (Start a cook does that).', 'bad'); return; }
  const cur = v.plan.name === 'Cooking points' ? v.plan : null;
  const st = { follow: cur ? (cur.tracks.pit[0].until || {}).probe || roles[0] : roles[0], setTemp: v.pit.set || null, points: cur ? cur.tracks.pit.slice(1).map((s, i) => ({ at: cur.tracks.pit[i].until.at_least, set: s.set })) : [] };
  const compose = () => composePlan({ setTemp: st.setTemp, meats: [{ probe: v.cook.probes[st.follow], name: st.follow }], points: st.points, follow: st.follow });
  const body = () => `<label class="field"><span>Follow</span><select id="follow">${roles.map(r => `<option value="${esc(r)}"${r === st.follow ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select></label>
    <div class="prows">${st.points.map((pt, i) => `<div class="prow"><span>when it hits</span><label class="field"><input data-p="${i}" data-k="at" type="number" inputmode="numeric" placeholder="165" value="${pt.at}"></label><span>smoker to</span><label class="field"><input data-p="${i}" data-k="set" type="number" inputmode="numeric" placeholder="250" value="${pt.set}"></label><button type="button" data-delp="${i}" aria-label="Remove">×</button></div>`).join('')}</div>
    <button type="button" class="add" id="add-point">Add a point</button><div id="start-check"></div>`;
  const check = sh => { const c = compose(); $('#start-check', sh).innerHTML = c.errors.length ? `<p class="refuse">${esc(c.errors.join(' '))}</p>` : st.points.length ? '<p class="okay">The points take over from the current setpoint; the meats keep their own lines.</p>' : '<p class="note">No points: the pit stays as it is.</p>'; $('#sheet-go', sh).disabled = c.errors.length > 0 || !st.points.filter(p => p.at && p.set).length; };
  const wire = sh => { $('#follow', sh).addEventListener('change', e => { st.follow = e.target.value; check(sh); }); $$('[data-p]', sh).forEach(el => el.addEventListener('input', () => { st.points[+el.dataset.p][el.dataset.k] = el.value; check(sh); })); $$('[data-delp]', sh).forEach(b => b.addEventListener('click', () => { st.points.splice(+b.dataset.delp, 1); redraw(sh); })); $('#add-point', sh).addEventListener('click', () => { st.points.push({ at: '', set: '' }); redraw(sh); }); check(sh); };
  const redraw = sh => { $('.body', sh).innerHTML = body(); wire(sh); };
  confirmSheet({ title: 'Cooking points', sub: 'When the meat you follow reaches a temperature, the smoker goes to another.', body: body(), label: 'Use these points', onOpen: wire,
    onFire: () => { const c = compose(); if (c.errors.length) return; placeOrder('plan', { plan: c.plan, probes: c.probes }); } });
}
function openTimer() {
  let minutes = 60, name = 'timer';
  openSheet({ title: 'Set a timer', sub: 'It counts on the screen, and your Jarvis chat gets told when it is up.',
    body: `${presetsHTML('timer', TIMER_PRESETS.filter(Boolean).concat([180]), 60, ' min', '')}<div class="grid2" style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><label class="field"><span>Minutes</span><input id="timer-min" type="number" inputmode="numeric" min="1" value="60"></label><label class="field"><span>Name</span><input id="timer-name" value="timer" placeholder="flip, spritz, wrap"></label></div>`,
    foot: '<button type="button" class="btn primary" id="sheet-go">Start the timer</button><button type="button" class="btn quiet" id="sheet-no">Not now</button>',
    onOpen: sh => { $$('[data-presets=timer] button', sh).forEach(b => b.addEventListener('click', () => { minutes = +b.dataset.v; $('#timer-min', sh).value = minutes; $$('[data-presets=timer] button', sh).forEach(x => x.classList.toggle('on', x === b)); })); $('#timer-min', sh).addEventListener('input', e => { minutes = +e.target.value || 0; }); $('#timer-name', sh).addEventListener('input', e => { name = e.target.value; }); $('#sheet-no', sh).addEventListener('click', closeSheet); $('#sheet-go', sh).addEventListener('click', () => { if (!(minutes > 0)) { toast('Minutes must be more than 0.', 'bad'); return; } closeSheet(); placeOrder('timer', { name: name.trim() || 'timer', minutes }); }); } });
}
function openAnswer(text) { placeOrder('answer', text); }
function openAllEvents() { const v = S.view; if (!v) return; openSheet({ title: 'Every event', full: true, body: logHTML(v.events, v.now, 0, v.cook), foot: '<button type="button" class="btn quiet" id="sheet-no">Close</button>', onOpen: sh => $('#sheet-no', sh).addEventListener('click', closeSheet) }); }
function openAccount() {
  const who = S.session && S.session.user ? S.session.user.email : 'not signed in';
  openSheet({ title: 'The Pit', body: `<div class="account"><div class="who">${S.mode === 'demo' ? 'Looking at a sample cook.' : `Signed in as ${esc(who)}.`}</div><div class="ver">version ${APP_VERSION}</div></div>`,
    foot: `${S.mode === 'demo' ? '<button type="button" class="btn primary" id="acc-live">Go to the live smoker</button>' : '<button type="button" class="btn" id="acc-demo">Look at a sample cook</button>'}<button type="button" class="btn quiet" id="acc-out">Sign out</button>`,
    onOpen: sh => { const l = $('#acc-live', sh); if (l) l.addEventListener('click', () => { closeSheet(); leaveDemo(); }); const d = $('#acc-demo', sh); if (d) d.addEventListener('click', () => { closeSheet(); enterDemo('brisket'); }); $('#acc-out', sh).addEventListener('click', () => { closeSheet(); signOutToGate(); }); } });
}
function openFullChart() {
  const v = S.view; if (!v) return;
  const el = document.createElement('div'); el.className = 'full-chart';
  el.innerHTML = `<div class="fh"><span class="title">${esc(v.plan.name)}</span><button type="button" data-w="all" class="on">Whole cook</button><button type="button" data-w="2">Last 2 h</button><button type="button" data-w="6">Last 6 h</button><button type="button" data-w="table">Table</button><button type="button" data-w="close">Close</button></div>${legendHTML(v)}<div class="chart"><canvas></canvas><div class="scrub"></div><div class="readout"></div></div><div class="tbl" hidden></div><div class="hint">Drag to scrub. Pinch to zoom, then drag to pan. Tap a legend chip to hide a line.</div>`;
  document.body.appendChild(el);
  const ch = new PitChart($('.chart', el), { zoom: true, full: true }); const data = chartDataOf(v); ch.setData(data);
  const paintLegend = () => { $$('.legend button', el).forEach(b => b.classList.toggle('off', !!S.hidden[b.dataset.v])); ch.setData(chartDataOf(v)); };
  $$('.legend button', el).forEach(b => b.addEventListener('click', () => { S.hidden[b.dataset.v] = !S.hidden[b.dataset.v]; paintLegend(); }));
  const table = () => { const rs = readingsOf(v); const every = rs.filter((r, i) => i % 5 === 0 || i === rs.length - 1); return `<table><tr><th>Time</th><th>Pit</th><th>Set</th>${v.roles.map(r => `<th>${esc(capFirst(r.role))}</th>`).join('')}</tr>${every.map(r => `<tr><td>${fmtClock(r.at)}</td><td>${r.pit == null ? '' : rnd(r.pit)}</td><td>${r.set || ''}</td>${v.roles.map(x => `<td>${r.probes[x.pid] == null ? '' : rnd(r.probes[x.pid])}</td>`).join('')}</tr>`).join('')}</table>`; };
  $$('.fh button', el).forEach(b => b.addEventListener('click', () => {
    const w = b.dataset.w;
    if (w === 'close') { ch.destroy(); el.remove(); return; }
    $$('.fh button', el).forEach(x => x.classList.toggle('on', x === b));
    const tbl = $('.tbl', el), chart = $('.chart', el);
    if (w === 'table') { tbl.hidden = false; chart.hidden = true; tbl.innerHTML = table(); return; }
    tbl.hidden = true; chart.hidden = false;
    if (w === 'all') ch.zoomTo(null); else { const end = data.t1; ch.zoomTo([end - (+w) * HOUR, end]); }
  }));
}
function downloadCsv() { const v = S.view; if (!v) return; const rs = readingsOf(v); const blob = new Blob([csvOf(rs, v.roles)], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `the-pit-${new Date(v.cook.startedAt).toISOString().slice(0, 10)}-${(v.plan.name || 'cook').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
async function toggleAlert(key, btn) {
  const on = btn.getAttribute('aria-checked') === 'true', next = !on, def = ENGINE.ALERTS[key].on;
  const map = Object.assign({}, S.pit.alerts || {}); if (next === def) delete map[key]; else map[key] = next;
  btn.setAttribute('aria-checked', String(next)); btn.disabled = true;
  if (S.mode === 'demo') { S.pit.alerts = map; store.set('pit.demo.alerts', map); btn.disabled = false; return; }
  try { await sb.patch(`pits?id=eq.${S.pit.id}`, { alerts: map }); S.pit.alerts = map; toast(`${ENGINE.ALERTS[key].name}: ${next ? 'on' : 'off, not watched'}. Counts from the next look.`, 'good'); }
  catch (e) { btn.setAttribute('aria-checked', String(on)); toast('Could not save the switch: ' + e.message, 'bad'); }
  btn.disabled = false;
}

// ---- plans: editor, duplicate, archive ------------------------------------------------------------------------------
const UNTIL_KINDS = [['', 'waits for you'], ['minutes', 'a time'], ['at_least', 'a probe reaches'], ['at_most', 'a probe drops to'], ['stall', 'the stall']];
function stepEditorHTML(role, s, i, n, probes) {
  const u = s.until || null, kind = !u ? '' : 'minutes' in u ? 'minutes' : 'at_least' in u ? 'at_least' : 'at_most' in u ? 'at_most' : 'stall';
  const probe = u ? ('stall' in u ? (u.stall === true ? role : u.stall) : u.probe || (role === 'pit' ? '' : role)) : '';
  return `<div class="estep" data-role="${esc(role)}" data-i="${i}"><div class="${role === 'pit' ? 'srow' : ''}"><label class="field"><span>Name</span><input data-f="name" value="${esc(s.name || '')}"></label>${role === 'pit' ? `<label class="field"><span>Pit setpoint °F (blank: leave it)</span><input data-f="set" type="number" inputmode="numeric" value="${typeof s.set === 'number' ? s.set : ''}"></label>` : ''}</div>
    <div class="srow3"><label class="field"><span>Until</span><select data-f="kind">${UNTIL_KINDS.map(([k, w]) => `<option value="${k}"${k === kind ? ' selected' : ''}>${w}</option>`).join('')}</select></label>
      <label class="field"><span>${kind === 'minutes' ? 'Minutes' : kind === 'stall' ? 'Flat for, min' : '°F'}</span><input data-f="value" type="number" inputmode="numeric" value="${kind === 'minutes' ? u.minutes : kind === 'at_least' ? u.at_least : kind === 'at_most' ? u.at_most : kind === 'stall' ? (u.flat_for || 20) : ''}"${kind ? '' : ' disabled'}></label>
      <label class="field"><span>Probe</span><select data-f="probe"${kind && kind !== 'minutes' ? '' : ' disabled'}>${(probes || []).map(p => `<option value="${esc(p)}"${p === probe ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select></label></div>
    <label class="field"><span>Tell me (use {${esc(probes && probes[0] || 'meat')}} and {pit} for the temperatures)</span><textarea data-f="tell">${esc(s.tell || '')}</textarea></label>
    <div class="srow"><label class="field"><span>Ask, answer one (optional)</span><input data-f="ask0" value="${esc(s.ask ? s.ask[0] : '')}"></label><label class="field"><span>Answer two</span><input data-f="ask1" value="${esc(s.ask ? s.ask[1] : '')}"></label></div>
    <div class="tools"><button type="button" data-t="up"${i === 0 ? ' disabled' : ''}>Up</button><button type="button" data-t="down"${i === n - 1 ? ' disabled' : ''}>Down</button><button type="button" data-t="del">Remove</button></div></div>`;
}
function openEditor(row) {
  const P = JSON.parse(JSON.stringify(row ? row.plan : { name: '', for: '', notes: '', max_pit: 300, probes: ['meat'], tracks: { pit: [{ name: 'Smoke', set: 225, tell: '' }] } }));
  const range = { min: S.pit ? S.pit.range_min : 150, max: S.pit ? S.pit.range_max : 700 };
  const html = () => `<div class="editor"><label class="field"><span>Name</span><input data-p="name" value="${esc(P.name)}"></label><div class="grid2"><label class="field"><span>For</span><input data-p="for" value="${esc(P.for || '')}"></label><label class="field"><span>Pit never above, °F</span><input data-p="max_pit" type="number" inputmode="numeric" value="${P.max_pit}"></label></div>
    <label class="field"><span>Notes</span><textarea data-p="notes">${esc(P.notes || '')}</textarea></label>
    <div><div class="note" style="margin-bottom:6px">Meat probes, by name (each gets its own track of steps)</div><div class="probes">${(P.probes || []).map(p => `<span class="pchip">${esc(p)}<button type="button" data-rmp="${esc(p)}" aria-label="Remove ${esc(p)}">×</button></span>`).join('')}<input id="new-probe" placeholder="add: ribs" autocapitalize="none"></div></div>
    ${['pit'].concat(P.probes || []).map(role => `<div class="etrack"><h4>${role === 'pit' ? 'The pit' : esc(role)}${role !== 'pit' && !(P.tracks[role] || []).length ? ' <span class="dim" style="font-weight:400">(no steps: it is only watched)</span>' : ''}</h4>${(P.tracks[role] || []).map((s, i, arr) => stepEditorHTML(role, s, i, arr.length, P.probes)).join('')}<button type="button" class="addstep" data-add="${esc(role)}">Add a step</button></div>`).join('')}
    <div class="errs" id="plan-errs"></div></div>`;
  const check = sh => { const errs = ENGINE.validatePlan(P, range); const box = $('#plan-errs', sh); box.className = 'errs' + (errs.length ? '' : ' ok'); box.innerHTML = errs.length ? errs.map(e => `<div>${esc(e)}</div>`).join('') : '<div>The plan checks out.</div>'; $('#sheet-go', sh).disabled = errs.length > 0; };
  const wire = sh => {
    $$('[data-p]', sh).forEach(el => el.addEventListener('input', () => { P[el.dataset.p] = el.dataset.p === 'max_pit' ? +el.value : el.value; check(sh); }));
    $('#new-probe', sh).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const v = e.target.value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_'); if (v && !(P.probes || []).includes(v)) { P.probes = (P.probes || []).concat(v); if (!P.tracks[v]) P.tracks[v] = []; redraw(sh); } } });
    $$('[data-rmp]', sh).forEach(b => b.addEventListener('click', () => { P.probes = P.probes.filter(p => p !== b.dataset.rmp); delete P.tracks[b.dataset.rmp]; redraw(sh); }));
    $$('[data-add]', sh).forEach(b => b.addEventListener('click', () => { const r = b.dataset.add; P.tracks[r] = (P.tracks[r] || []).concat([{ name: '', tell: '' }]); redraw(sh); }));
    $$('.estep', sh).forEach(box => {
      const role = box.dataset.role, i = +box.dataset.i, s = P.tracks[role][i];
      const setUntil = () => { const kind = $('[data-f=kind]', box).value, val = +$('[data-f=value]', box).value, probe = $('[data-f=probe]', box).value; if (!kind) delete s.until; else if (kind === 'minutes') s.until = { minutes: val }; else if (kind === 'stall') s.until = Object.assign({ stall: role === 'pit' ? probe : true }, val && val !== 20 ? { flat_for: val } : {}); else { s.until = {}; s.until[kind] = val; if (role === 'pit') s.until.probe = probe; } };
      $$('[data-f]', box).forEach(el => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
        const f = el.dataset.f;
        if (f === 'name' || f === 'tell') { s[f] = el.value; if (!el.value) delete s[f]; }
        else if (f === 'set') { if (el.value === '') delete s.set; else s.set = +el.value; }
        else if (f === 'ask0' || f === 'ask1') { const a = [$('[data-f=ask0]', box).value, $('[data-f=ask1]', box).value]; if (a[0] || a[1]) s.ask = a; else delete s.ask; }
        else { setUntil(); if (f === 'kind') { redraw(sh); return; } }
        check(sh);
      }));
      $$('[data-t]', box).forEach(b => b.addEventListener('click', () => { const arr = P.tracks[role]; if (b.dataset.t === 'del') arr.splice(i, 1); else { const j = b.dataset.t === 'up' ? i - 1 : i + 1; [arr[i], arr[j]] = [arr[j], arr[i]]; } redraw(sh); }));
    });
    check(sh);
  };
  const redraw = sh => { const y = sh.scrollTop; $('.body', sh).innerHTML = html(); wire(sh); sh.scrollTop = y; };
  openSheet({ title: row ? 'Edit the plan' : 'New plan', full: true, sub: 'A plan is one pit track that sets the pit, and a track per meat that only talks. Every change is checked by the engine as you type; a running cook keeps its own copy.', body: html(),
    foot: '<button type="button" class="btn primary" id="sheet-go">Save the plan</button><button type="button" class="btn quiet" id="sheet-no">Cancel</button>',
    onOpen: sh => { wire(sh); $('#sheet-no', sh).addEventListener('click', closeSheet); $('#sheet-go', sh).addEventListener('click', () => { closeSheet(); savePlan(row ? row.id : null, P); }); } });
}
async function savePlan(id, plan) {
  if (S.mode === 'demo') {
    const saved = store.get('pit.demo.plans') || [];
    if (id && !String(id).startsWith('demo-saved-')) id = null;
    const rowId = id || 'demo-saved-' + Date.now(), row = { id: rowId, name: plan.name, plan, archived: false };
    const i = saved.findIndex(r => r.id === rowId); if (i >= 0) saved[i] = row; else saved.push(row);
    store.set('pit.demo.plans', saved); const j = S.plans.findIndex(r => r.id === rowId); if (j >= 0) S.plans[j] = row; else S.plans.push(row); DEMO.planRows = null;
    toast(id ? 'Plan saved (sample mode: kept on this device).' : 'New plan saved (sample mode: kept on this device).', 'good'); go('plans', rowId); return;
  }
  placeOrder('save_plan', id ? { id, plan } : { plan }, { after: () => loadPlans().then(renderAll) });
}
function archivePlan(id) {
  const r = S.plans.find(p => p.id === id); if (!r) return;
  confirmSheet({ title: 'Archive the plan', sub: `“${esc(r.plan.name)}” leaves the list. Past cooks keep their own copy of it.`, label: 'Archive', cls: 'danger', onFire: () => {
    if (S.mode === 'demo') { r.archived = true; const saved = (store.get('pit.demo.plans') || []).filter(x => x.id !== id); store.set('pit.demo.plans', saved); go('plans'); return; }
    placeOrder('archive_plan', id, { after: () => loadPlans().then(() => go('plans')) });
  } });
}

// ---- every tap on the main area ------------------------------------------------------------------------------------
function onMainClick(e) {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act, v = b.dataset.v;
  if (act === 'start-cook') openNewCook();
  else if (act === 'read-now') openReadNow();
  else if (act === 'expand') openFullChart();
  else if (act === 'legend') { S.hidden[v] = !S.hidden[v]; b.classList.toggle('off', !!S.hidden[v]); b.setAttribute('aria-pressed', String(!S.hidden[v])); if (S.chart && S.view) S.chart.setData(chartDataOf(S.view)); }
  else if (act === 'answer') openAnswer(v);
  else if (act === 'all-events') openAllEvents();
  else if (act === 'power') openPower();
  else if (act === 'open-plan') go('plans', v);
  else if (act === 'new-plan') openEditor(null);
  else if (act === 'edit-plan') openEditor(S.plans.find(p => p.id === v));
  else if (act === 'dup-plan') { const r = S.plans.find(p => p.id === v); if (r) { const copyRow = { plan: JSON.parse(JSON.stringify(r.plan)) }; copyRow.plan.name = r.plan.name + ' (copy)'; openEditor(copyRow); } }
  else if (act === 'archive-plan') archivePlan(v);
  else if (act === 'start-plan') openStartPlan(S.plans.find(p => p.id === v));
  else if (act === 'use-plan') openUsePlan(S.plans.find(p => p.id === v));
  else if (act === 'points') openPoints();
  else if (act === 'timer') openTimer();
  else if (act === 'open-cook') go('history', v);
  else if (act === 'rate') { const c = S.history.find(h => h.id === S.sub); if (!c) return; c.rating = +v; if (S.mode === 'demo') store.set(`pit.demo.rating.${c.id.replace('demo-', '')}`, +v); else placeOrder('rate', { cook_id: c.id, rating: +v }, { cookId: c.id }); renderAll(); }
  else if (act === 'save-note') { const c = S.history.find(h => h.id === S.sub); if (!c) return; c.notes = $('#note-text').value; if (S.mode === 'demo') { store.set(`pit.demo.notes.${c.id.replace('demo-', '')}`, c.notes); toast('Note kept on this device (sample mode).', 'good'); } else placeOrder('note', { cook_id: c.id, text: c.notes }, { cookId: c.id }); }
  else if (act === 'csv') downloadCsv();
  else if (act === 'toggle') toggleAlert(v, b);
}
function onActionsClick(e) {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act;
  if (act === 'set') openSetPit(); else if (act === 'next') openNext(); else if (act === 'pause') placeOrder('pause'); else if (act === 'resume') openResume();
  else if (act === 'done') openDone(); else if (act === 'rested') openRested(); else if (act === 'end') openEnd();
}

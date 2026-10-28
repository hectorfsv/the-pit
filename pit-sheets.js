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
function openNewCook(planId) {
  const plans = S.plans.filter(p => !p.archived); if (!plans.length) { toast('No plans yet.', 'bad'); return; }
  const last = S.last || (S.view && S.view.last), pids = ['p0', 'p1', 'p2', 'p3'];
  const probeLabel = p => `Probe ${p.slice(1)}${last && last.probes && last.probes[p] != null ? `, ${rnd(last.probes[p])}°` : ', not reading'}`;
  let sel = plans.find(p => p.id === planId) || plans[0], tells = [];
  const body = () => {
    const roles = sel.plan.probes || [];
    return `<div class="radio-list">${plans.map(p => `<label class="${p.id === sel.id ? 'on' : ''}"><input type="radio" name="plan" value="${esc(p.id)}"${p.id === sel.id ? ' checked' : ''}><span><span class="t">${esc(p.plan.name)}</span><div class="d">${planSummary(p.plan)}</div></span></label>`).join('')}</div>
      ${roles.length ? `<div class="assign"><div class="note">Which probe is in which meat?</div>${roles.map((r, i) => `<div class="a"><div class="r" style="--c:${MEAT_COLORS[i % 4]}"><i></i>${esc(r)}</div><label class="field"><select data-role="${esc(r)}"><option value="">no probe</option>${pids.map(p => `<option value="${p}"${i === 0 && p === 'p0' ? ' selected' : ''}>${probeLabel(p)}</option>`).join('')}</select></label></div>`).join('')}</div>` : ''}
      <div class="tells"><div class="note">Also tell me when a probe gets to a temperature (any plan; the whole point of Just watch).</div><div id="tell-rows">${tells.map((t, i) => `<div class="t"><label class="field"><input data-i="${i}" data-k="name" placeholder="sausage" value="${esc(t.name)}"></label><label class="field"><select data-i="${i}" data-k="probe">${pids.map(p => `<option value="${p}"${t.probe === p ? ' selected' : ''}>${p.toUpperCase()}</option>`).join('')}</select></label><label class="field"><input data-i="${i}" data-k="at" type="number" inputmode="numeric" placeholder="°F" value="${t.at || ''}"></label><button type="button" data-del="${i}" aria-label="Remove">×</button></div>`).join('')}</div><button type="button" class="add" id="add-tell">Add a line</button></div>
      <div class="grid2" style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><label class="field"><span>Meat (optional)</span><input id="nc-meat" placeholder="brisket, 14 lb packer"></label><label class="field"><span>Weight, lb (optional)</span><input id="nc-weight" type="number" inputmode="decimal" step="0.1"></label></div>
      ${refusals(last).length ? `<p class="refuse">${esc(refusals(last).join(' '))}</p>` : '<p class="okay">The smoker is on, in °F and online.</p>'}`;
  };
  const wire = sh => {
    $$('input[name=plan]', sh).forEach(r => r.addEventListener('change', () => { sel = plans.find(p => p.id === r.value); redraw(sh); }));
    $$('#tell-rows [data-k]', sh).forEach(el => el.addEventListener('input', () => { tells[+el.dataset.i][el.dataset.k] = el.dataset.k === 'at' ? +el.value : el.value; }));
    $$('#tell-rows [data-del]', sh).forEach(b => b.addEventListener('click', () => { tells.splice(+b.dataset.del, 1); redraw(sh); }));
    $('#add-tell', sh).addEventListener('click', () => { tells.push({ name: '', probe: 'p1', at: '' }); redraw(sh); });
  };
  const redraw = sh => { const meat = $('#nc-meat', sh).value, w = $('#nc-weight', sh).value; $('.body', sh).innerHTML = body(); $('#nc-meat', sh).value = meat; $('#nc-weight', sh).value = w; wire(sh); };
  confirmSheet({ title: 'Start a cook', sub: 'The plan freezes as it is now; editing the recipe later never changes a running cook.', body: body(), label: 'Start the cook', disabled: refusals(last).length > 0, full: true,
    onOpen: wire,
    onFire: () => {
      const sh = $('#sheet-root .sheet') || document; const probes = {};
      $$('select[data-role]').forEach(s => { if (s.value) probes[s.dataset.role] = s.value; });
      const value = { plan_id: sel.id, probes, meat: $('#nc-meat') ? $('#nc-meat').value.trim() || undefined : undefined, weight_lb: $('#nc-weight') && $('#nc-weight').value ? +$('#nc-weight').value : undefined, tells: tells.filter(t => t.name && t.at).map(t => ({ name: t.name, probe: t.probe, at: +t.at })) };
      if (!value.tells.length) delete value.tells;
      placeOrder('start', value, { cookId: null });
    } });
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
  else if (act === 'start-plan') openNewCook(v);
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

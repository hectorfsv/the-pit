#!/usr/bin/env node
/* The Pit's page in real WebKit (Safari's engine, the webkit-check install), at the phone, the desk tablet and the
   Mac, on the sample cooks. Asserts what is on screen: the numbers, the graph's pixels, the Cook done button inside
   the viewport, no horizontal overflow, no field under 16px, no spilled text, no page errors. Screenshots in shots/.
     node test/check.js --base http://127.0.0.1:8765/ [--only now-brisket] [--out test/shots]
   (run.sh serves the folder and calls this.) */
const path = require('path');
const fs = require('fs');
const { webkit } = require(path.join(__dirname, '..', '..', '..', 'webkit-check', 'node_modules', 'playwright'));

const args = process.argv.slice(2), flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const BASE = flag('--base', 'http://127.0.0.1:8765/'), OUT = path.resolve(flag('--out', path.join(__dirname, 'shots'))), ONLY = flag('--only', null);
const VPS = [
  { name: 'phone-700', w: 393, h: 700, mobile: true },     // Safari's address bar showing: the short one finds the most
  { name: 'phone-956', w: 440, h: 956, mobile: true },     // his iPhone 18 Pro Max
  { name: 'tablet', w: 800, h: 1280, mobile: true },       // the desk tablet, portrait
  { name: 'desktop', w: 1280, h: 820, mobile: false },
  { name: 'tv', w: 1443, h: 812, mobile: false },          // the Fire TV Stick inside Hubs: 1920x1080 at 1.33
  { name: 'phone-land', w: 956, h: 440, mobile: true },   // his phone on its side, for the full graph only
];
const PROBE = () => {
  const de = document.documentElement, overflow = de.scrollWidth - de.clientWidth;
  const smallFields = [...document.querySelectorAll('input,textarea,select')].filter(e => !['checkbox', 'radio', 'range', 'file'].includes(e.type)).filter(e => e.offsetParent !== null)
    .filter(e => parseFloat(getComputedStyle(e).fontSize) < 16).map(e => `${e.tagName.toLowerCase()}#${e.id || e.name || e.className || '?'}@${getComputedStyle(e).fontSize}`);
  const spilled = [...document.querySelectorAll('*')].filter(e => {
    if (e.scrollWidth <= e.clientWidth + 1 || e.clientWidth <= 1 || e.clientHeight <= 1 || /^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName)) return false;
    const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || /auto|scroll/.test(cs.overflowX) || cs.overflow === 'hidden') return false;
    return e.children.length === 0 || cs.whiteSpace === 'nowrap';
  }).slice(0, 6).map(e => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : e.className ? '.' + String(e.className).split(' ')[0] : ''} ${e.clientWidth}<${e.scrollWidth}`);
  return { overflow, smallFields, spilled };
};
const painted = sel => { const c = document.querySelector(sel); if (!c) return -1; const ctx = c.getContext('2d'), d = ctx.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4 * 7) if (d[i] > 40) n++; return n; };
const vis = sel => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, bottom: r.bottom, text: (e.textContent || '').trim().slice(0, 80), vh: innerHeight, vw: innerWidth }; };
const count = sel => document.querySelectorAll(sel).length;
const text = sel => { const e = document.querySelector(sel); return e ? e.textContent.trim() : null; };
// The status chip as the live page draws it (a sample cook's chip says "Sample cook" whatever the smoker does).
const liveChip = () => { const m = S.mode; S.mode = 'live'; renderStatus(); const t = document.querySelector('#status').textContent.trim(); S.mode = m; renderStatus(); return t; };

const noBar = p => p.evaluate(() => { const b = document.querySelector('#demobar'); if (b) b.style.display = 'none'; window.dispatchEvent(new Event('resize')); });   // a real cook has no sample bar
// The TV has one screen to fill: everything named must sit above the bottom bar, with nothing to scroll for.
const tvFits = async (p, sels) => {
  const f = [], bar = await p.evaluate(vis, '.bottom'), html = await p.evaluate(() => document.documentElement.classList.contains('tv'));
  if (!html) f.push('html.tv is not set');
  for (const s of sels) { const v = await p.evaluate(vis, s); if (!v) f.push(`${s} is missing`); else if (v.bottom > bar.y + 1) f.push(`${s} ends at ${Math.round(v.bottom)}, under the bar at ${Math.round(bar.y)}`); }
  return f;
};
// Each scenario: a URL, something to do first, then what must be on screen. The failures are sentences.
const SCENARIOS = [
  { name: 'gate', url: 'index.html', check: async p => { const f = []; if (!(await p.evaluate(() => !document.querySelector('#gate').hidden))) f.push('the gate is not shown without a session'); if ((await p.evaluate(count, '#gate input')) !== 2) f.push('the gate does not have two fields'); return f; } },
  { name: 'now-brisket', url: 'index.html?demo=brisket#now', check: async p => {
    const f = [];
    const meat = await p.evaluate(text, '.meat .temp'); if (!/^\d{2,3}°F$/.test((meat || '').replace(/\s/g, ''))) f.push(`the meat numeral reads "${meat}"`);
    const pit = await p.evaluate(text, '.pit .temp'); if (!/^\d{2,3}°F$/.test((pit || '').replace(/\s/g, ''))) f.push(`the pit numeral reads "${pit}"`);
    if (!/^(Cooking|Paused)/.test(await p.evaluate(text, '.phase h2') || '')) f.push('the phase line does not say Cooking');
    const px = await p.evaluate(painted, '#chart canvas'); if (px < 400) f.push(`the graph canvas has ${px} lit samples`);
    const sp = await p.evaluate(painted, 'canvas.spark'); if (sp < 20) f.push(`the sparkline has ${sp} lit samples`);
    if ((await p.evaluate(count, '#actions .btn')) !== 4) f.push('the action bar does not show four buttons');
    const done = await p.evaluate(vis, '#actions .btn.primary'); if (!done) f.push('no Cook done button'); else if (done.bottom > done.vh + 1 || done.y < 0) f.push(`Cook done sits at ${Math.round(done.y)}–${Math.round(done.bottom)} in a ${done.vh} viewport`); else if (!/Cook done/.test(done.text)) f.push(`the primary action reads "${done.text}"`);
    if ((await p.evaluate(count, '.steps li.cur')) !== 1) f.push('the plan list has no current step');
    if ((await p.evaluate(count, '.log li')) < 3) f.push('the log shows fewer than three events');
    if (!/Lid.*not watched/.test(await p.evaluate(text, '.sensors') || '')) f.push('the lid sensor does not read "not watched"');
    if (!/at this pace/.test(await p.evaluate(text, '.meat') || '')) f.push('no "at this pace" line two hours before Cook done');
    const legend = await p.evaluate(count, '.legend button'); if (legend !== 3) f.push(`the legend has ${legend} chips, not 3`);
    const pc = await p.evaluate(vis, '.pit'), mc = await p.evaluate(vis, '.meat'); if (!pc || !mc || pc.y > mc.y) f.push('the pit card is not above the first meat card (his rule 10-29: the pit first, big)');
    if (!(await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.pit .temp')).fontSize) > parseFloat(getComputedStyle(document.querySelector('.meat .temp')).fontSize)))) f.push('the pit numeral is not bigger than the meat numeral');
    const wide = await p.evaluate(() => innerWidth >= 760); if (wide) { const g = await p.evaluate(vis, '.graph'), m = await p.evaluate(vis, '.meat'); if (g && m && g.x < m.x + m.w) f.push('on a wide screen the graph is not in its own column'); }
    return f; } },
  { name: 'now-stall', url: 'index.html?demo=brisket&at=572#now', vps: ['phone-956'], check: async p => { const f = []; if (!(await p.evaluate(count, '.meat .rate.stall'))) f.push('no stall badge at minute 572 of the brisket'); if (!/the stall/.test(await p.evaluate(text, '.meat .rate') || '')) f.push('the rate line does not name the stall'); return f; } },
  { name: 'now-ask', url: 'index.html?demo=ribs&at=262#now', vps: ['phone-956', 'tablet'], check: async p => { const f = []; if ((await p.evaluate(count, '.ask .btn')) !== 2) f.push('the ribs ask (Wrapped / Keep going) is not on screen at minute 262'); if ((await p.evaluate(count, '.meat')) !== 2) f.push('ribs and chicken do not both have a card'); if ((await p.evaluate(count, '.legend button')) !== 4) f.push('the legend does not show both meats'); return f; } },
  { name: 'now-rest', url: 'index.html?demo=brisket&at=880#now', vps: ['phone-956'], check: async p => { const f = []; if (!/^Resting/.test(await p.evaluate(text, '.phase h2') || '')) f.push('the phase is not Resting at minute 880'); if (!/End cook/.test(await p.evaluate(text, '#actions .btn.primary') || '')) f.push('the primary action in the rest is not End cook'); if (!/resting/.test(await p.evaluate(text, '.meat .line') || '')) f.push('the meat card does not say resting'); return f; } },
  { name: 'now-hold', url: 'index.html?demo=brisket&at=1050#now', vps: ['phone-700'], check: async p => { const f = []; if (!/^Holding/.test(await p.evaluate(text, '.phase h2') || '')) f.push('the phase is not Holding at minute 1050'); if ((await p.evaluate(count, '.steps li.cur')) !== 1) f.push('the hold is not the current step'); return f; } },
  // The one screen (11-01): always Pit, thermometers, graph, the rest; a plan is an extra on it.
  { name: 'now-empty', url: 'index.html?demo=empty#now', vps: ['phone-700', 'phone-956', 'tablet', 'desktop'], check: async p => { const f = [];
    if (await p.evaluate(() => /No cook running|Start a cook/.test(document.body.textContent))) f.push('the old empty screen or Start a cook is back');
    if (!/^\d{2,3}°F$/.test(((await p.evaluate(text, '.pit .temp')) || '').replace(/\s/g, ''))) f.push('no pit number with the smoker off');
    if (!/smoker off/.test(await p.evaluate(text, '.pit .heat') || '')) f.push('the Pit tile does not say the smoker is off');
    if ((await p.evaluate(count, '.meat')) !== 1) f.push('the plugged thermometer has no tile');
    if (!/Probe 1|Meat/i.test(await p.evaluate(text, '.meat .role') || '')) f.push('the tile has no name');
    if (await p.evaluate(count, '#chart')) f.push('a graph on a new screen: nothing of the last cook belongs here');
    if (await p.evaluate(() => /last session|Lately|Full graph/.test(document.querySelector('#main').textContent))) f.push('last cook info on a new screen');
    if (await p.evaluate(count, '.phase')) f.push('a plan header with no plan');
    if (await p.evaluate(count, '.ask')) f.push('an old ask is back on screen');
    if ((await p.evaluate(count, '#actions .btn')) !== 3) f.push('the bar is not Read now, Set pit, Power');
    if (!/Power on/.test(await p.evaluate(text, '#actions') || '')) f.push('the bar does not offer Power on with the smoker off');
    if (!(await p.evaluate(count, '[data-act=go-plans]'))) f.push('no way to a plan');
    const pc = await p.evaluate(vis, '.pit'), mc = await p.evaluate(vis, '.meat'); if (!pc || !mc || pc.y > mc.y) f.push('the Pit is not first');
    return f; } },
  { name: 'now-open', url: 'index.html?demo=open#now', vps: ['phone-700', 'phone-956', 'tablet', 'desktop'], check: async p => { const f = [];
    if (await p.evaluate(count, '.phase')) f.push('a plan header on a session with no plan');
    if (!/On since/.test(await p.evaluate(text, '.pit .next') || '')) f.push('no session clock on the Pit tile');
    if ((await p.evaluate(count, '.meat')) !== 2) f.push('two thermometers read, ' + await p.evaluate(count, '.meat') + ' tiles');
    if ((await p.evaluate(count, '.legend button')) !== 5) f.push('the pulled thermometer lost its line on the graph');
    const [a, b] = await p.evaluate(() => [...document.querySelectorAll('.meat')].map(e => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width }; }));
    if (!a || !b || Math.abs(a.y - b.y) > 1 || b.x < a.x + a.w) f.push('the tiles do not sit side by side');
    if (!/no target/.test(await p.evaluate(text, '.meat') || '')) f.push('a thermometer with no plan should say so');
    const bar = await p.evaluate(text, '#actions') || '';   // the pit is set hot here (the brisket's), so Cook done has something to lower
    if ((await p.evaluate(count, '#actions .btn')) !== 3 || !/Cook done/.test(bar) || !/End session/.test(bar)) f.push('the bar on a hand-run session is not Set pit, Cook done, End session: ' + bar);
    if ((await p.evaluate(count, '.steps li'))) f.push('plan steps with no plan');
    if (!(await p.evaluate(count, '[data-act=points]'))) f.push('no Cooking points on a session');
    if ((await p.evaluate(painted, '#chart canvas')) < 400) f.push('no graph');
    return f; } },
  { name: 'now-plug', url: 'index.html?demo=brisket&plug=2#now', vps: ['phone-700', 'phone-956', 'tablet', 'desktop'], check: async p => { const f = [];
    if ((await p.evaluate(count, '.meat')) !== 3) f.push('three thermometers, not three tiles');
    if (!(await p.evaluate(count, '.phase'))) f.push('the plan header should stay while a plan runs');
    const names = await p.evaluate(() => [...document.querySelectorAll('.meat .role')].map(e => e.textContent));
    if (!/meat/i.test(names[0] || '')) f.push('the thermometer the plan follows is not first: ' + names);
    if (!/at this pace|until|Probe/.test(await p.evaluate(text, '.tiles') || '')) f.push('the tiles lost their lines');
    if ((await p.evaluate(count, '#actions .btn')) !== 4) f.push('the plan bar changed');
    return f; } },
  { name: 'sheet-tile', url: 'index.html?demo=brisket&plug=1#now', vps: ['phone-700', 'phone-956', 'desktop'], before: async p => { await p.click('.meat[data-pid=p2]'); await p.waitForSelector('.overlay.in .sheet'); }, check: async p => { const f = [];
    if (!/Probe 2/.test(await p.evaluate(text, '.overlay.in .sheet h2') || '')) f.push('the sheet is not about Probe 2');
    if (!(await p.evaluate(count, '#th-name')) || !(await p.evaluate(count, '#th-at'))) f.push('no name or tell-me-at field');
    const opt = await p.evaluate(() => [...document.querySelectorAll('#th-follow option')].map(o => o.text).join('|'));
    if (!/no, it just shows/.test(opt) || !/the meat/.test(opt)) f.push('the plan\'s thermometer pick is missing: ' + opt);
    await p.fill('#th-name', 'flat'); await p.fill('#th-at', '190'); await p.click('#sheet-go'); await p.waitForTimeout(300);
    if (!/nothing is sent/.test(await p.evaluate(text, '#toasts') || '')) f.push('Save did not place an order');
    return f; } },
  { name: 'sheet-tile-plan', url: 'index.html?demo=brisket#now', vps: ['phone-956'], before: async p => { await p.click('.meat[data-pid=p0]'); await p.waitForSelector('.overlay.in .sheet'); }, check: async p => { const f = [];
    if (!(await p.evaluate(() => document.querySelector('#th-follow').disabled))) f.push('the thermometer a plan follows must not unbind from its own sheet');
    if (!/tap the thermometer that should take over/.test(await p.evaluate(text, '.overlay.in .sheet') || '')) f.push('it does not say how to change it');
    return f; } },
  { name: 'set-idle', url: 'index.html?demo=empty#now', vps: ['phone-956'], before: async p => { await p.click('.pit .set-temp'); await p.waitForSelector('.overlay.in .sheet'); }, check: async p => { const f = []; if (!/Set the pit to \d+°F/.test(await p.evaluate(text, '#sheet-go') || '')) f.push('Set temp does not work with the smoker off'); return f; } },
  { name: 'plans', url: 'index.html?demo=brisket#plans', check: async p => { const f = []; const n = await p.evaluate(count, '.plan-card'); if (n < 6) f.push(`${n} plan cards, expected the five plans and New plan`); if (await p.evaluate(() => document.querySelector('#strip').hidden)) f.push('the live strip is missing on the Plans tab during a cook'); return f; } },
  { name: 'plan-view', url: 'index.html?demo=brisket#plans/demo-monclova-low-n-slow', vps: ['phone-956', 'desktop'], check: async p => { const f = []; if ((await p.evaluate(count, '.track')) < 1) f.push('no tracks on the plan view'); if ((await p.evaluate(count, '.plan-view .row .btn')) !== 4) f.push('the plan view does not offer the four actions during a cook'); return f; } },
  { name: 'history', url: 'index.html?demo=brisket#history', check: async p => { const f = []; if ((await p.evaluate(count, '.cook-card')) !== 2) f.push('history does not list the two sample cooks'); await p.waitForTimeout(300); const px = await p.evaluate(painted, '.cook-card canvas'); if (px < 20) f.push(`a cook card thumbnail has ${px} lit samples`); return f; } },
  { name: 'past', url: 'index.html?demo=brisket#history/demo-brisket', vps: ['phone-956', 'tablet'], check: async p => { const f = []; if ((await p.evaluate(count, '.miles tr')) < 6) f.push('the milestones table is short'); const px = await p.evaluate(painted, '#chart canvas'); if (px < 400) f.push(`the past cook graph has ${px} lit samples`); if ((await p.evaluate(count, '.rate-row button')) !== 5) f.push('no five stars'); if ((await p.evaluate(count, '.log li')) < 15) f.push('the past cook log is not the whole log'); return f; } },
  { name: 'alerts', url: 'index.html?demo=brisket#alerts', check: async p => { const f = []; if ((await p.evaluate(count, '.sw')) !== 14) f.push('not 14 switches'); if ((await p.evaluate(count, '.alerts .phone')) !== 1) f.push('no Phone alerts card at the top of the Alerts tab'); const lid = await p.evaluate(() => { const b = [...document.querySelectorAll('.tog')].find(x => x.dataset.v === 'lid'); return b && b.getAttribute('aria-checked'); }); if (lid !== 'false') f.push(`the lid switch reads ${lid}, not off`); return f; } },
  { name: 'set-temp', url: 'index.html?demo=brisket#now', vps: ['phone-700', 'phone-956', 'tablet', 'desktop'], check: async p => {
    const f = [], m = await p.evaluate(() => { const q = s => document.querySelector(s), box = e => e.getBoundingClientRect(), b = q('.pit .set-temp'), t = q('.pit .temp'), timer = q('.pit-tools .mini'); return b && t && timer ? { text: b.textContent.trim(), h: box(b).height, timerH: box(timer).height, tile: box(q('article.pit')).height, wide: innerWidth >= 760, btnSize: parseFloat(getComputedStyle(b).fontSize), tempSize: parseFloat(getComputedStyle(t).fontSize), inTile: box(b).right <= box(q('article.pit')).right } : null; });
    if (!m) return ['the Pit tile has no Set temp button, number or Set timer'];
    if (!/^Set temp \d+$/.test(m.text)) f.push(`the button reads "${m.text}"`);
    if (m.h < 44) f.push(`Set temp is ${m.h}px tall, under 44`);
    if (m.h <= m.timerH) f.push(`Set temp (${m.h}px) is not bigger than Set timer (${m.timerH}px)`);
    if (m.btnSize * 4 > m.tempSize) f.push(`the pit number (${m.tempSize}px) no longer dominates Set temp (${m.btnSize}px)`);
    if (m.tile !== (m.wide ? 204 : 191)) f.push(`the Pit tile grew to ${m.tile}px (was ${m.wide ? 204 : 191})`);
    if (!m.inTile) f.push('Set temp spills out of the tile');
    await p.click('.pit .set-temp'); await p.waitForSelector('.overlay.in .sheet');
    if (!/Set temp/.test(await p.evaluate(text, '.overlay.in .sheet') || '')) f.push('the sheet is not titled Set temp');
    if (!/Set the pit to \d+°F/.test(await p.evaluate(text, '#sheet-go') || '')) f.push('the sheet has no confirm with the temperature');
    return f; } },
  { name: 'sheet-set', url: 'index.html?demo=brisket#now', vps: ['phone-700', 'phone-956'], before: async p => { await p.click('#actions [data-act=set]'); await p.waitForSelector('.overlay.in .sheet'); }, check: async p => { const f = []; if (!/^\d+°F$/.test((await p.evaluate(text, '.stepper .val') || '').replace(/\s/g, ''))) f.push('the set sheet shows no setpoint'); if (!/Set the pit to \d+°F/.test(await p.evaluate(text, '#sheet-go') || '')) f.push('the hold button does not name the setpoint'); return f; } },
  { name: 'sheet-start-plan', url: 'index.html?demo=empty#plans/demo-monclova-low-n-slow', vps: ['phone-956'], before: async p => { await p.click('[data-act=start-plan]'); await p.waitForSelector('.overlay.in .sheet'); }, check: async p => { const f = []; const pick = await p.evaluate(() => { const s = document.querySelector('select[data-role=meat]'); return { v: s && s.value, opts: s ? [...s.options].map(o => o.text) : [] }; }); if (pick.v !== 'p1') f.push('the meat should start on Probe 1, the one reading, not ' + pick.v); if (pick.opts.join().includes('P0')) f.push('an empty port is back in the picker: ' + pick.opts); if (pick.opts.filter(o => /^Probe/.test(o)).length !== 3) f.push('not three probes: ' + pick.opts); return f; } },
  { name: 'sheet-start-plan-p2', url: 'index.html?demo=empty#plans/demo-monclova-low-n-slow', vps: ['phone-956'], before: async p => { await p.evaluate(() => { S.last.probes = { p0: null, p1: null, p2: 60, p3: null }; }); await p.click('[data-act=start-plan]'); await p.waitForSelector('.overlay.in .sheet'); }, check: async p => { const f = []; const v = await p.evaluate(() => document.querySelector('select[data-role=meat]').value); if (v !== 'p2') f.push('the meat should start on the probe that reads, not ' + v); return f; } },
  { name: 'sheet-use-plan', url: 'index.html?demo=brisket#plans/demo-fiesta-style', vps: ['phone-956'], before: async p => { await p.click('[data-act=use-plan]'); await p.waitForSelector('.overlay.in .sheet'); }, check: async p => { const f = []; if ((await p.evaluate(count, 'select[data-role]')) !== 2) f.push('Fiesta needs two probe pickers on the running cook'); if (!/Use this plan now/.test(await p.evaluate(text, '#sheet-go') || '')) f.push('no hold button to use the plan'); return f; } },
  { name: 'sheet-points', url: 'index.html?demo=brisket#now', vps: ['phone-956'], before: async p => { await p.click('[data-act=points]'); await p.waitForSelector('.overlay.in .sheet'); }, check: async p => { const f = []; if (!(await p.evaluate(count, '#follow'))) f.push('no meat to follow'); await p.click('#add-point'); await p.fill('[data-p="0"][data-k=at]', '190'); await p.fill('[data-p="0"][data-k=set]', '300'); await p.waitForTimeout(150); if (await p.evaluate(() => document.querySelector('#sheet-go').disabled)) f.push(`a valid point leaves the button disabled: ${await p.evaluate(text, '#start-check')}`); return f; } },
  { name: 'sheet-timer', url: 'index.html?demo=brisket#now', vps: ['phone-956'], before: async p => { await p.click('[data-act=timer]'); await p.waitForSelector('.overlay.in .sheet'); }, check: async p => { const f = []; if (!(await p.evaluate(count, '#timer-min'))) f.push('no minutes field'); if ((await p.evaluate(count, '[data-presets=timer] button')) < 5) f.push('no timer presets'); return f; } },
  // Live (11-03): the listener's row, fed the way the poller feeds it. A report changes the numbers in place (the graph
  // canvas must be the same element after it); a plugged thermometer redraws; a stale row falls back to the readings.
  { name: 'live-cook', url: 'index.html?demo=brisket#now', vps: ['phone-700', 'phone-956', 'tablet', 'desktop'], before: async p => {
    await p.evaluate(() => { window.__chart = document.querySelector('#chart canvas'); window.__live = r => applyLive(Object.assign({ at: new Date(S.now()).toISOString(), got_at: new Date().toISOString(), setpoint: S.readings[S.readings.length - 1].set, heating: true, power: true, fah: true, lid_open: false, door_open: false, errors: [0, 0, 0, 0, 0], rssi: -52, probes: Object.assign({}, S.readings[S.readings.length - 1].probes) }, r)); });
    await p.evaluate(() => { const k = Object.keys(S.readings[S.readings.length - 1].probes).find(x => S.readings[S.readings.length - 1].probes[x] != null); window.__pid = k; __live({ pit: 241, probes: Object.assign({}, S.readings[S.readings.length - 1].probes, { [k]: 175 }) }); }); }, check: async p => { const f = [];
    if (((await p.evaluate(text, '.pit .temp')) || '').replace(/\s/g, '') !== '241°F') f.push(`the Pit tile reads "${await p.evaluate(text, '.pit .temp')}", not the live 241°F`);
    if (!/live/.test(await p.evaluate(text, '.pit .stepname') || '')) f.push('the Pit tile does not say live');
    if (((await p.evaluate(() => document.querySelector(`.meat[data-pid="${__pid}"] .temp`).textContent)) || '').replace(/\s/g, '') !== '175°F') f.push('the meat tile is not the live 175°F');
    await p.evaluate(() => { window.__chart = document.querySelector('#chart canvas'); });   // live starting redraws once, for the label
    await p.evaluate(() => __live({ pit: 242, heating: false, probes: Object.assign({}, S.readings[S.readings.length - 1].probes, { [__pid]: 176 }) }));
    if (((await p.evaluate(text, '.pit .temp')) || '').replace(/\s/g, '') !== '242°F') f.push('the second report did not reach the Pit tile');
    if (!/holding/.test(await p.evaluate(text, '.pit .heat') || '')) f.push('heating did not turn to holding in place');
    if (!(await p.evaluate(() => document.querySelector('#chart canvas') === __chart))) f.push('a live report redrew the graph');
    return f; } },
  { name: 'live-plug', url: 'index.html?demo=brisket#now', vps: ['phone-956', 'desktop'], before: async p => {
    await p.evaluate(() => { window.__n = document.querySelectorAll('.meat').length; const l = S.readings[S.readings.length - 1]; applyLive({ at: new Date(S.now()).toISOString(), got_at: new Date().toISOString(), pit: 230, setpoint: l.set, heating: true, power: true, fah: true, lid_open: false, door_open: false, errors: [], rssi: -50, probes: Object.assign({}, l.probes, { p3: 151 }) }); }); }, check: async p => { const f = [];
    if ((await p.evaluate(count, '.meat')) !== (await p.evaluate(() => __n)) + 1) f.push('a thermometer plugged in live has no tile');
    if (!/151/.test(await p.evaluate(text, '.meat[data-pid=p3] .temp') || '')) f.push('the new tile does not read 151');
    return f; } },
  { name: 'live-stale', url: 'index.html?demo=brisket#now', vps: ['phone-956'], before: async p => {
    await p.evaluate(() => { window.__pit = document.querySelector('.pit .temp').textContent; const l = S.readings[S.readings.length - 1]; applyLive({ at: new Date(S.now()).toISOString(), got_at: new Date(Date.now() - 2 * 60000).toISOString(), pit: 299, setpoint: l.set, heating: true, power: true, fah: true, probes: l.probes, errors: [], rssi: -50 }); }); }, check: async p => { const f = [];
    if (/live/.test(await p.evaluate(text, '.pit .stepname') || '')) f.push('a row two minutes old still says live');
    if ((await p.evaluate(text, '.pit .temp')) !== (await p.evaluate(() => __pit))) f.push('a stale row reached the Pit tile');
    return f; } },
  { name: 'live-idle', url: 'index.html?demo=empty#now', vps: ['phone-956', 'desktop'], before: async p => {
    await p.evaluate(() => applyLive({ at: new Date().toISOString(), got_at: new Date().toISOString(), pit: 188, setpoint: 225, heating: true, power: true, fah: true, lid_open: false, door_open: false, probes: { p0: null, p1: 66, p2: null, p3: null }, errors: [0, 0, 0, 0, 0], rssi: -48 })); }, check: async p => { const f = [];
    if (((await p.evaluate(text, '.pit .temp')) || '').replace(/\s/g, '') !== '188°F') f.push('the smoker alone does not show the live 188°F');
    if (/smoker off/.test(await p.evaluate(text, '.pit .heat') || '')) f.push('the live row says on, the tile says off');
    if (!/Set temp 225/.test(await p.evaluate(text, '.pit .set-temp') || '')) f.push('Set temp does not carry the live setpoint');
    if (!/live/.test(await p.evaluate(text, '.meat .age') || '')) f.push('the thermometer does not say live');
    if (!/Power off/.test(await p.evaluate(text, '#actions') || '')) f.push('the bar does not offer Power off with the smoker on');
    return f; } },
  { name: 'open-cold', url: 'index.html?demo=open#now', vps: ['phone-956', 'desktop'], before: async p => {   // 11-03: a session, nothing sent, the pit cold: Cook done would only have raised it
    await p.evaluate(() => applyLive({ at: new Date().toISOString(), got_at: new Date().toISOString(), pit: 58, setpoint: 0, heating: false, power: true, fah: true, lid_open: false, door_open: false, probes: { p0: null, p1: 58, p2: 59, p3: 61 }, errors: [0, 0, 0, 0, 0], rssi: -48 })); }, check: async p => { const f = [];
    const bar = await p.evaluate(text, '#actions') || '';
    if ((await p.evaluate(count, '#actions .btn')) !== 2 || /Cook done/.test(bar) || !/End session/.test(bar)) f.push('a session with the pit not set should offer Set pit and End session only: ' + bar);
    if (!/^live$/.test(await p.evaluate(liveChip))) f.push('the chip does not say live with the power on');
    return f; } },
  { name: 'live-off', url: 'index.html?demo=empty#now', vps: ['phone-956', 'desktop'], before: async p => {   // the smoker reports for minutes after the power goes off: the page says off, never a green live
    await p.evaluate(() => applyLive({ at: new Date().toISOString(), got_at: new Date().toISOString(), pit: 54, setpoint: 0, heating: false, power: false, fah: true, lid_open: false, door_open: false, probes: { p0: null, p1: 54, p2: 54, p3: 56 }, errors: [0, 0, 0, 0, 0], rssi: -54 })); }, check: async p => { const f = [];
    const chip = await p.evaluate(liveChip);
    if (chip !== 'smoker off') f.push('the chip with the power off says: ' + chip);
    if (await p.evaluate(() => { const m = S.mode; S.mode = 'live'; renderStatus(); const on = document.querySelector('#status').classList.contains('on'); S.mode = m; renderStatus(); return on; })) f.push('the chip is green with the power off');
    if ((await p.evaluate(text, '.pit .stepname') || '').trim() !== 'off') f.push('the Pit tile tag is not "off": ' + await p.evaluate(text, '.pit .stepname'));
    if (!/smoker off/.test(await p.evaluate(text, '.pit .heat') || '')) f.push('the tile does not say smoker off');
    if (!/Power on/.test(await p.evaluate(text, '#actions') || '')) f.push('the bar does not offer Power on');
    return f; } },
  { name: 'standby', url: 'index.html?demo=empty&standby=1#now', vps: ['phone-700', 'phone-956', 'tablet', 'desktop'], check: async p => { const f = [];
    if (!(await p.evaluate(count, '#main .standby'))) return ['no stand-by with the smoker off'];
    if ((await p.evaluate(text, '.sb-state')) !== 'Smoker off') f.push('the state line is not "Smoker off"');
    if (!(await p.evaluate(count, '.standby video'))) f.push('no video element');
    if (!/Power on/.test(await p.evaluate(text, '.standby .sb-power') || '')) f.push('no Power on on the stand-by');
    if (!(await p.evaluate(() => document.querySelector('#actions').hidden))) f.push('the action bar shows under the stand-by');
    if (await p.evaluate(count, '.pit')) f.push('the Pit tile shows under the stand-by');
    const sb = await p.evaluate(vis, '.standby'), bar = await p.evaluate(vis, '.bottom');
    if (!sb || sb.bottom > bar.y + 1 || sb.bottom - sb.y < 300) f.push(`the stand-by does not fill the screen above the tabs (${sb && Math.round(sb.bottom - sb.y)} px tall, ends ${sb && Math.round(sb.bottom)}, tabs at ${Math.round(bar.y)})`);
    const body = await p.evaluate(vis, '.sb-body'); if (!body || body.bottom > bar.y + 1) f.push('the words run under the tabs');
    return f; } },
  { name: 'standby-peek', url: 'index.html?demo=empty&standby=1#now', vps: ['phone-956'], before: async p => { await p.click('.standby .sb-state'); await p.waitForSelector('.pit .temp', { timeout: 3000 }).catch(() => {}); }, check: async p => { const f = [];
    if (await p.evaluate(count, '.standby')) f.push('a tap did not lift the stand-by');
    if (!(await p.evaluate(count, '.pit .temp'))) f.push('the page is not under it');
    if (!/Power on/.test(await p.evaluate(text, '#actions') || '')) f.push('the bar is not back under the lifted stand-by');
    return f; } },
  { name: 'tv-standby', before: noBar, url: 'index.html?demo=empty&standby=1&tv=1#now', vps: ['tv'], check: async p => {
    const f = await tvFits(p, ['.standby', '.sb-body']);
    if (!(await p.evaluate(() => document.activeElement && document.activeElement.classList.contains('standby')))) f.push('the ring is not on the stand-by');
    return f; } },
  { name: 'live-tv', url: 'index.html?demo=brisket&tv=1#now', vps: ['tv'], before: async p => { await noBar(p); await p.waitForTimeout(150);
    await p.evaluate(() => { document.querySelector('.pit .set-temp').focus(); window.__chart = document.querySelector('#chart canvas'); const l = S.readings[S.readings.length - 1];
      for (const [pit, heating] of [[233, true], [234, false], [235, true]]) { if (pit === 234) window.__chart = document.querySelector('#chart canvas'); applyLive({ at: new Date(S.now()).toISOString(), got_at: new Date().toISOString(), pit, setpoint: l.set, heating, power: true, fah: true, lid_open: false, door_open: false, probes: l.probes, errors: [], rssi: -50 }); } }); }, check: async p => { const f = [];
    if (!(await p.evaluate(() => document.activeElement && document.activeElement.matches('.pit .set-temp')))) f.push('three live reports moved the ring off Set temp');
    if (((await p.evaluate(text, '.pit .temp')) || '').replace(/\s/g, '') !== '235°F') f.push('the TV does not show the live 235°F');
    if (!(await p.evaluate(() => document.querySelector('#chart canvas') === __chart))) f.push('live redrew the graph on the TV');
    f.push(...await tvFits(p, ['.pit', '.meat', '.chart']));
    return f; } },
  { name: 'tv-cook', before: noBar, url: 'index.html?demo=brisket&tv=1#now', vps: ['tv'], check: async p => tvFits(p, ['.pit', '.meat', '.chart']) },
  { name: 'tv-ribs', before: noBar, url: 'index.html?demo=ribs-chicken&tv=1#now', vps: ['tv'], check: async p => tvFits(p, ['.pit', '.meat', '.chart']) },
  { name: 'tv-open', before: noBar, url: 'index.html?demo=open&plug=3&tv=1#now', vps: ['tv'], check: async p => tvFits(p, ['.pit', '.meat', '.chart']) },
  { name: 'tv-idle', before: noBar, url: 'index.html?demo=empty&tv=1#now', vps: ['tv'], check: async p => tvFits(p, ['.pit']) },
  { name: 'full-chart', url: 'index.html?demo=brisket#now', vps: ['phone-956', 'phone-land', 'tablet'], before: async p => { await p.click('[data-act=expand]'); await p.waitForSelector('.full-chart canvas'); await p.waitForTimeout(200); }, check: async p => { const f = []; const px = await p.evaluate(painted, '.full-chart canvas'); if (px < 800) f.push(`the full graph has ${px} lit samples`); const h = await p.evaluate(vis, '.full-chart .chart'); if (h && h.bottom > h.vh + 1) f.push(`the full graph runs ${Math.round(h.bottom - h.vh)}px past the bottom of the screen`); const hint = await p.evaluate(vis, '.full-chart .hint'); if (hint && hint.bottom > hint.vh + 1) f.push('the hint line is off screen'); return f; } },
  { name: 'editor', url: 'index.html?demo=brisket#plans/demo-monclova-low-n-slow', vps: ['phone-956', 'desktop'], before: async p => { await p.click('[data-act=edit-plan]'); await p.waitForSelector('.overlay.in .editor'); }, check: async p => { const f = []; if ((await p.evaluate(count, '.estep')) < 5) f.push('the editor does not show the five pit steps'); if (!(await p.evaluate(count, '#plan-errs.ok'))) f.push(`the engine does not accept the saved plan as is: ${await p.evaluate(text, '#plan-errs')}`); return f; } },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await webkit.launch();
  let fails = 0, runs = 0;
  for (const sc of SCENARIOS) {
    if (ONLY && sc.name !== ONLY) continue;
    for (const vp of VPS) {
      if (sc.vps ? !sc.vps.includes(vp.name) : vp.name === 'phone-land') continue;
      runs++;
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 2, isMobile: vp.mobile, hasTouch: vp.mobile, colorScheme: 'dark' });
      const page = await ctx.newPage(); const errors = [];
      page.on('pageerror', e => errors.push('page error: ' + e.message)); page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
      const f = [];
      try {
        await page.goto(BASE + sc.url, { waitUntil: 'networkidle' }); await page.waitForTimeout(350);
        if (sc.before) await sc.before(page);
        await page.waitForTimeout(150);
        f.push(...await sc.check(page));
        const pr = await page.evaluate(PROBE);
        if (pr.overflow > 0) f.push(`horizontal overflow ${pr.overflow}px`);
        if (pr.smallFields.length) f.push('fields under 16px: ' + pr.smallFields.join(', '));
        if (pr.spilled.length) f.push('spilled text: ' + pr.spilled.join(', '));
        f.push(...errors.filter(e => !/favicon|fonts.g|net::|Failed to load resource/.test(e)));
        await page.screenshot({ path: path.join(OUT, `${sc.name}-${vp.name}.png`), fullPage: false });
        if (!sc.before && vp.name === 'phone-956') await page.screenshot({ path: path.join(OUT, `${sc.name}-${vp.name}-full.png`), fullPage: true });
      } catch (e) { f.push('threw: ' + e.message.split('\n')[0]); }
      await ctx.close();
      const ok = f.length === 0; if (!ok) fails++;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${sc.name} @ ${vp.name}${ok ? '' : '\n       ' + f.join('\n       ')}`);
    }
  }
  await browser.close();
  console.log(`\n${runs - fails} of ${runs} renders clean. Screenshots: ${OUT}`);
  process.exit(fails ? 1 : 0);
})();

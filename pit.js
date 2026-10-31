/* The Pit — the doors in and the clock: sign-in, the live notebook (reads every 30 s while a cook runs, every 3 s for
   a while after an order), the sample cooks, the four tabs. */
'use strict';
const TABS = ['now', 'plans', 'history', 'alerts'];

// ---- routes ---------------------------------------------------------------------------------------------------
function go(tab, sub) { const h = '#' + tab + (sub ? '/' + encodeURIComponent(sub) : ''); if (location.hash === h) onHash(); else location.hash = h; }
function readHash() { const h = (location.hash || '#now').slice(1).split('/'); S.tab = TABS.includes(h[0]) ? h[0] : 'now'; S.sub = h[1] ? decodeURIComponent(h.slice(1).join('/')) : null; }
function onHash() {
  readHash(); closeSheet(); window.scrollTo(0, 0); renderAll();
  if (S.mode === 'live') { if (S.tab === 'plans' && !S.plansAt) loadPlans().then(renderAll).catch(err); if (S.tab === 'history' && !S.historyAt) loadHistory().then(renderAll).catch(err); }
}
const err = e => toast(e && e.message ? e.message : String(e), 'bad', 7000);

// ---- the gate -------------------------------------------------------------------------------------------------
function showGate() { stopPolling(); S.mode = null; $('#app').hidden = true; $('#gate').hidden = false; }
async function onSignIn(e) {
  e.preventDefault();
  const btn = $('#signin-btn'), msg = $('#signin-err'); msg.hidden = true; btn.disabled = true; btn.textContent = 'Signing in…';
  try { await sb.signIn($('#email').value.trim(), $('#password').value); await enterLive(); }
  catch (ex) { msg.textContent = ex.message; msg.hidden = false; }
  btn.disabled = false; btn.textContent = 'Sign in';
}
function signOutToGate() { sb.signOut(); S.cook = null; S.readings = []; S.events = []; S.last = null; S.history = []; S.histData = {}; S.plans = []; S.plansAt = 0; S.historyAt = 0; showGate(); }

// ---- live -----------------------------------------------------------------------------------------------------
async function enterLive() {
  S.mode = 'live'; S.now = () => Date.now(); $('#gate').hidden = true; $('#app').hidden = false; $('#demobar').hidden = true;
  try { await loadLive(); }
  catch (e) { if (/Signed out|expired|Not signed in/.test(e.message)) { showGate(); const m = $('#signin-err'); m.textContent = e.message; m.hidden = false; return; } toast('Could not read the notebook: ' + e.message, 'bad', 8000); }
  renderAll(); startPolling(); pushSync();
  if (S.tab === 'plans') loadPlans().then(renderAll).catch(err); if (S.tab === 'history') loadHistory().then(renderAll).catch(err);
}
async function loadLive() {
  const pits = await sb.get('pits?select=id,name,range_min,range_max,alerts&order=created_at.asc&limit=1');
  S.pit = pits[0] || null; S.pitAt = Date.now();
  await Promise.all([loadPlans(), refreshLive(true)]);
}
async function loadPlans() { S.plans = (await sb.get('plans?select=id,name,plan,archived,updated_at&order=name.asc')).filter(p => p.plan); S.plansAt = Date.now(); }
async function loadHistory() {
  const rows = await sb.get('cooks?status=in.(done,stopped)&order=started_at.desc&limit=60&select=id,pit_id,plan_id,meat,weight_lb,status,state,started_at,ended_at,notes,rating');
  S.history = rows.map(normCook); S.historyAt = Date.now();
}
const READING_COLS = 'at,pit,setpoint,heating,power,fah,lid_open,door_open,probes,errors,rssi', EVENT_COLS = 'id,at,kind,who,track,step,text,ask,data';
async function loadHistData(id) {
  if (S.histData[id]) return S.histData[id];
  if (S.mode === 'demo') { const d = DEMO.data[String(id).replace('demo-', '')]; if (d) S.histData[id] = { readings: d.readings, events: d.events }; return S.histData[id]; }
  try {
    const [rs, es] = await Promise.all([sb.get(`readings?cook_id=eq.${id}&order=at.asc&select=${READING_COLS}`), sb.get(`events?cook_id=eq.${id}&order=at.asc,id.asc&select=${EVENT_COLS}`)]);
    S.histData[id] = { readings: rs.map(normReading), events: es.map(normEvent).filter(Boolean) };
  } catch (e) { toast('Could not load that cook: ' + e.message, 'bad'); }
  return S.histData[id];
}
const signature = () => JSON.stringify([S.cook && [S.cook.id, S.cook.status, S.cook.phase, S.cook.pending, S.cook.failed], S.readings.length, S.events.length, S.last && S.last.at, S.pit && S.pit.alerts, S.tab, S.sub]);
async function refreshLive(full) {
  if (S.mode !== 'live' || S.busy) return;
  S.busy = true; const before = signature();
  try {
    const rows = await sb.get('cooks?status=in.(running,paused)&order=started_at.desc&limit=1&select=id,pit_id,plan_id,meat,weight_lb,status,state,started_at,ended_at,heartbeat_at,runner_url,notes,rating');
    const row = rows[0] ? normCook(rows[0]) : null;
    if (row) {
      if (!S.cook || S.cook.id !== row.id || full) { S.readings = []; S.events = []; S.hidden = {}; }
      S.cook = row;
      const lastAt = S.readings.length ? new Date(S.readings[S.readings.length - 1].at).toISOString() : null, lastId = S.events.length ? S.events[S.events.length - 1].id : null;
      const [rs, es] = await Promise.all([
        sb.get(`readings?cook_id=eq.${row.id}&order=at.asc&select=${READING_COLS}${lastAt ? `&at=gt.${encodeURIComponent(lastAt)}` : ''}`),
        sb.get(`events?cook_id=eq.${row.id}&order=at.asc,id.asc&select=${EVENT_COLS}${lastId != null ? `&id=gt.${lastId}` : ''}`)]);
      if (rs.length) S.readings = S.readings.concat(rs.map(normReading));
      if (es.length) S.events = S.events.concat(es.map(normEvent).filter(Boolean));
    } else {
      if (S.cook) { S.cook = null; S.readings = []; S.events = []; S.historyAt = 0; }
      const last = await sb.get(`readings?order=at.desc&limit=1&select=${READING_COLS}`); S.last = last[0] ? normReading(last[0]) : null;
    }
    if (full || Date.now() - (S.pitAt || 0) > 5 * MINUTE) { const pits = await sb.get('pits?select=id,name,range_min,range_max,alerts&order=created_at.asc&limit=1'); if (pits[0]) S.pit = pits[0]; S.pitAt = Date.now(); }
    S.error = null;
  } catch (e) {
    S.error = e.message;
    if (/Signed out|expired/.test(e.message)) { S.busy = false; showGate(); return; }
  } finally { S.busy = false; }
  if (!full) { if (signature() !== before) renderAll(); else { renderStatus(); tickAges(); } }
}
function fastPoll(seconds) { S.fastUntil = Date.now() + seconds * 1000; schedule(1500); }
function nextDelay() { if (Date.now() < S.fastUntil) return 3000; return S.cook ? 30000 : 60000; }
function schedule(ms) { clearTimeout(S.timer); S.timer = setTimeout(pollTick, ms); }
async function pollTick() { if (S.mode !== 'live') return; if (document.visibilityState === 'visible') await refreshLive(false); schedule(nextDelay()); }
function startPolling() { schedule(nextDelay()); if (!S.ageTimer) S.ageTimer = setInterval(tickAges, 10000); if (!S.verTimer) S.verTimer = setInterval(checkVersion, 60000); }
// A home-screen app keeps the page for ten minutes; this tells him sooner, and a tap reloads (a reload refetches index.html).
async function checkVersion() {
  if (document.visibilityState !== 'visible' || S.newVersion) return;
  try { const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' }); const j = await r.json(); if (j.version && j.version !== APP_VERSION) { S.newVersion = j.version; const t = toast('A newer version of The Pit is ready. Tap here to load it.', 'good', 0); t.el.addEventListener('click', () => location.reload()); } } catch (e) { /* offline: fine */ }
}
function stopPolling() { clearTimeout(S.timer); S.timer = null; }

// ---- the sample cooks -----------------------------------------------------------------------------------------
async function enterDemo(which, atMinutes) {
  stopPolling(); $('#gate').hidden = true; $('#app').hidden = false;
  S.mode = 'demo'; DEMO.which = DEMO.files[which] || which === 'empty' ? which : 'brisket'; DEMO.t = null;
  try { await loadDemoData(); } catch (e) { toast('Could not load the sample cooks: ' + e.message, 'bad', 8000); return; }
  S.plans = DEMO.planRows.slice(); S.plansAt = Date.now(); S.historyAt = Date.now(); S.hidden = {};
  if (atMinutes != null && DEMO.data[DEMO.which]) DEMO.t = DEMO.data[DEMO.which].t0 + atMinutes * MINUTE;
  applyDemo(); if (!S.ageTimer) S.ageTimer = setInterval(tickAges, 10000); if (!S.verTimer) S.verTimer = setInterval(checkVersion, 60000);
  renderAll();
}
function applyDemo() {
  S.history = Object.values(DEMO.data).map(x => Object.assign(demoCookAt(x, x.tEnd), { status: 'done', endedAt: x.tEnd })).sort((a, b) => b.startedAt - a.startedAt);
  for (const x of Object.values(DEMO.data)) S.histData['demo-' + x.key] = { readings: x.readings, events: x.events };
  const d = DEMO.data[DEMO.which];
  if (!d) {   // "no cook running": the smoker as it was at the end of the brisket, read ten minutes ago
    const b = DEMO.data.brisket, last = b.readings[b.readings.length - 1], now = Date.now();
    S.cook = null; S.readings = []; S.events = []; S.now = () => now; S.last = Object.assign({}, last, { at: now - 40 * 1000, set: 0, heating: false, probes: { p1: 71.5 } });
    return;
  }
  if (DEMO.t == null) DEMO.t = d.tDone ? d.tDone - 2 * HOUR : d.t0 + (d.tEnd - d.t0) * 0.7;
  DEMO.t = Math.min(d.tEnd, Math.max(d.t0 + 5 * MINUTE, DEMO.t));
  const t = DEMO.t; S.now = () => t;
  S.cook = demoCookAt(d, t); S.readings = d.readings.filter(r => r.at <= t); S.events = d.events.filter(e => e.at <= t);
  S.last = S.readings[S.readings.length - 1] || null;
}
function leaveDemo() { S.mode = null; S.cook = null; S.readings = []; S.events = []; S.last = null; S.history = []; S.histData = {}; S.hidden = {}; S.plans = []; S.plansAt = 0; S.historyAt = 0; S.now = () => Date.now(); $('#demobar').hidden = true; if (S.session) enterLive(); else showGate(); }

// ---- boot -----------------------------------------------------------------------------------------------------
function boot() {
  const q = new URLSearchParams(location.search);
  $('#signin').addEventListener('submit', onSignIn);
  $('#see-demo').addEventListener('click', () => enterDemo('brisket'));
  $('#account').addEventListener('click', openAccount);
  $('#brand').addEventListener('click', e => { e.preventDefault(); go('now'); });
  $('#main').addEventListener('click', onMainClick);
  $('#actions').addEventListener('click', onActionsClick);
  $('#strip').addEventListener('click', () => go('now'));
  window.addEventListener('hashchange', onHash);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.mode === 'live') refreshLive(false); });
  let wasWide = wideScreen();
  window.addEventListener('resize', () => { const w = wideScreen(); if (w !== wasWide) { wasWide = w; renderAll(); } });
  readHash(); pushInit();
  if (q.has('demo')) return enterDemo(q.get('demo') || 'brisket', q.has('at') ? +q.get('at') : null);
  const sess = store.get('pit.session');
  if (sess && sess.refresh_token) { S.session = sess; return enterLive(); }
  showGate();
}
boot();

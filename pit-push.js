/* The Pit — phone alerts: Web Push for the home-screen app. An iPhone takes push for a web app opened from its Home
   Screen icon (iOS 16.4 and later); the switch is on the Alerts tab. The engine on n8n sends every alert it tells the
   Jarvis chat to every phone in push_subscriptions; sw.js shows it and a tap opens the cook. The worker caches nothing. */
'use strict';
const PUSH = { ready: false, supported: false, reg: null, sub: null, permission: 'default', busy: false, error: null };
let pushInitP = null;
function pushSupported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
function pushInit() {
  if (pushInitP) return pushInitP;
  return pushInitP = (async () => {
    PUSH.supported = pushSupported();
    if (PUSH.supported) {
      try { PUSH.reg = await navigator.serviceWorker.register('sw.js'); PUSH.sub = await PUSH.reg.pushManager.getSubscription(); PUSH.permission = Notification.permission; }
      catch (e) { PUSH.error = e.message; }
    }
    PUSH.ready = true;
    if (S.tab === 'alerts') renderAll();
  })();
}
// A phone that is already on re-saves its subscription once per endpoint (the notebook may have dropped a dead one).
async function pushSync() { await pushInit(); if (S.mode !== 'live' || !PUSH.sub || store.get('pit.push.saved') === PUSH.sub.endpoint) return; try { await pushSave(PUSH.sub); } catch (e) { /* the next open */ } }
function pushLabel() { const ua = navigator.userAgent, dev = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : 'phone'; return dev + (navigator.standalone ? ', home screen' : ''); }
function b64uToBytes(s) { const b = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4); return Uint8Array.from(atob(b), c => c.charCodeAt(0)); }
async function pushSave(sub) {
  const j = sub.toJSON();
  await sb.upsert('push_subscriptions', { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, label: pushLabel() }, 'endpoint');
  store.set('pit.push.saved', j.endpoint);
}
async function pushOn(btn) {
  if (PUSH.busy) return;
  if (S.mode !== 'live') { toast('Sign in first: phone alerts belong to your account.', 'wait'); return; }
  if (!CFG.vapidPublicKey) { toast('This page has no push key yet.', 'bad'); return; }
  PUSH.busy = true; btn.disabled = true;
  try {
    if (!PUSH.reg) PUSH.reg = await navigator.serviceWorker.register('sw.js');
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(CFG.vapidPublicKey) });
    PUSH.sub = sub; PUSH.permission = Notification.permission;
    await pushSave(sub);
    toast('Phone alerts are on for this phone. Send a test to hear one.', 'good', 6000);
  } catch (e) {
    PUSH.permission = 'Notification' in window ? Notification.permission : 'default';
    toast(PUSH.permission === 'denied' ? 'Blocked for The Pit. iPhone: Settings, Notifications, The Pit, Allow Notifications.' : 'Could not turn on phone alerts: ' + e.message, 'bad', 8000);
  }
  PUSH.busy = false; renderAll();
}
async function pushOff(btn) {
  if (PUSH.busy || !PUSH.sub) return;
  PUSH.busy = true; btn.disabled = true;
  const endpoint = PUSH.sub.endpoint;
  try { await PUSH.sub.unsubscribe(); } catch (e) { /* the row goes anyway */ }
  PUSH.sub = null; store.set('pit.push.saved', '');
  try { if (S.mode === 'live') await sb.del(`push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`); toast('Phone alerts are off for this phone. Your Jarvis chat still gets every alert.', 'good'); }
  catch (e) { toast('This phone forgot the alerts, but the notebook kept its row: ' + e.message, 'bad', 8000); }
  PUSH.busy = false; renderAll();
}
function pushTest() { if (S.mode !== 'live') { toast('Sample cook: nothing is sent.', 'wait'); return; } placeOrder('ping', { label: pushLabel() }); }
// The card at the top of the Alerts tab.
function phoneAlertsHTML() {
  const head = (n, w) => `<div><div class="n">${n}</div><div class="w">${w}</div></div>`;
  if (!PUSH.ready) return `<div class="phone">${head('Phone alerts', 'checking this phone…')}</div>`;
  if (!PUSH.supported) return `<div class="phone">${head('Phone alerts', 'They work from the Home Screen icon: in Safari tap Share, then Add to Home Screen, open The Pit from there and the switch appears here. Your Jarvis chat gets every alert either way.')}</div>`;
  if (PUSH.sub) return `<div class="phone on">${head('Phone alerts: on for this phone', 'Every alert that goes to your Jarvis chat also rings here, with The Pit closed.')}<div class="two"><button type="button" class="btn" data-act="push-test">Send a test</button><button type="button" class="btn quiet" data-act="push-off">Turn off</button></div></div>`;
  if (PUSH.permission === 'denied') return `<div class="phone">${head('Phone alerts: blocked', 'iPhone: Settings, Notifications, The Pit, Allow Notifications. Then come back here.')}</div>`;
  return `<div class="phone">${head('Phone alerts', 'Ring this phone with every alert, even with The Pit closed. Your Jarvis chat keeps getting them too.')}<button type="button" class="btn primary" data-act="push-on">Turn on</button></div>`;
}

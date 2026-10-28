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
    const wide = await p.evaluate(() => innerWidth >= 760); if (wide) { const g = await p.evaluate(vis, '.graph'), m = await p.evaluate(vis, '.meat'); if (g && m && g.x < m.x + m.w) f.push('on a wide screen the graph is not in its own column'); }
    return f; } },
  { name: 'now-stall', url: 'index.html?demo=brisket&at=572#now', vps: ['phone-956'], check: async p => { const f = []; if (!(await p.evaluate(count, '.meat .rate.stall'))) f.push('no stall badge at minute 572 of the brisket'); if (!/the stall/.test(await p.evaluate(text, '.meat .rate') || '')) f.push('the rate line does not name the stall'); return f; } },
  { name: 'now-ask', url: 'index.html?demo=ribs&at=262#now', vps: ['phone-956', 'tablet'], check: async p => { const f = []; if ((await p.evaluate(count, '.ask .btn')) !== 2) f.push('the ribs ask (Wrapped / Keep going) is not on screen at minute 262'); if ((await p.evaluate(count, '.meat')) !== 2) f.push('ribs and chicken do not both have a card'); if ((await p.evaluate(count, '.legend button')) !== 4) f.push('the legend does not show both meats'); return f; } },
  { name: 'now-rest', url: 'index.html?demo=brisket&at=880#now', vps: ['phone-956'], check: async p => { const f = []; if (!/^Resting/.test(await p.evaluate(text, '.phase h2') || '')) f.push('the phase is not Resting at minute 880'); if (!/End cook/.test(await p.evaluate(text, '#actions .btn.primary') || '')) f.push('the primary action in the rest is not End cook'); if (!/resting/.test(await p.evaluate(text, '.meat .line') || '')) f.push('the meat card does not say resting'); return f; } },
  { name: 'now-hold', url: 'index.html?demo=brisket&at=1050#now', vps: ['phone-700'], check: async p => { const f = []; if (!/^Holding/.test(await p.evaluate(text, '.phase h2') || '')) f.push('the phase is not Holding at minute 1050'); if ((await p.evaluate(count, '.steps li.cur')) !== 1) f.push('the hold is not the current step'); return f; } },
  { name: 'now-empty', url: 'index.html?demo=empty#now', vps: ['phone-700', 'phone-956'], check: async p => { const f = []; if (!/No cook running/.test(await p.evaluate(text, '.empty-cook h2') || '')) f.push('the empty state is missing'); if (!(await p.evaluate(count, '[data-act=start-cook]'))) f.push('no Start a cook button'); if (await p.evaluate(() => !document.querySelector('#actions').hidden)) f.push('the action bar shows with no cook'); return f; } },
  { name: 'plans', url: 'index.html?demo=brisket#plans', check: async p => { const f = []; const n = await p.evaluate(count, '.plan-card'); if (n < 6) f.push(`${n} plan cards, expected the five plans and New plan`); if (await p.evaluate(() => document.querySelector('#strip').hidden)) f.push('the live strip is missing on the Plans tab during a cook'); return f; } },
  { name: 'plan-view', url: 'index.html?demo=brisket#plans/demo-monclova-low-n-slow', vps: ['phone-956', 'desktop'], check: async p => { const f = []; if ((await p.evaluate(count, '.track')) < 1) f.push('no tracks on the plan view'); if ((await p.evaluate(count, '.plan-view .row .btn')) !== 4) f.push('the plan view does not offer four actions'); return f; } },
  { name: 'history', url: 'index.html?demo=brisket#history', check: async p => { const f = []; if ((await p.evaluate(count, '.cook-card')) !== 2) f.push('history does not list the two sample cooks'); await p.waitForTimeout(300); const px = await p.evaluate(painted, '.cook-card canvas'); if (px < 20) f.push(`a cook card thumbnail has ${px} lit samples`); return f; } },
  { name: 'past', url: 'index.html?demo=brisket#history/demo-brisket', vps: ['phone-956', 'tablet'], check: async p => { const f = []; if ((await p.evaluate(count, '.miles tr')) < 6) f.push('the milestones table is short'); const px = await p.evaluate(painted, '#chart canvas'); if (px < 400) f.push(`the past cook graph has ${px} lit samples`); if ((await p.evaluate(count, '.rate-row button')) !== 5) f.push('no five stars'); if ((await p.evaluate(count, '.log li')) < 15) f.push('the past cook log is not the whole log'); return f; } },
  { name: 'alerts', url: 'index.html?demo=brisket#alerts', check: async p => { const f = []; if ((await p.evaluate(count, '.sw')) !== 14) f.push('not 14 switches'); const lid = await p.evaluate(() => { const b = [...document.querySelectorAll('.tog')].find(x => x.dataset.v === 'lid'); return b && b.getAttribute('aria-checked'); }); if (lid !== 'false') f.push(`the lid switch reads ${lid}, not off`); return f; } },
  { name: 'sheet-set', url: 'index.html?demo=brisket#now', vps: ['phone-700', 'phone-956'], before: async p => { await p.click('#actions [data-act=set]'); await p.waitForSelector('.overlay.in .sheet'); }, check: async p => { const f = []; if (!/^\d+°F$/.test((await p.evaluate(text, '.stepper .val') || '').replace(/\s/g, ''))) f.push('the set sheet shows no setpoint'); if (!/Set the pit to \d+°F/.test(await p.evaluate(text, '#sheet-go') || '')) f.push('the hold button does not name the setpoint'); return f; } },
  { name: 'sheet-newcook', url: 'index.html?demo=empty#now', vps: ['phone-700', 'phone-956', 'tablet'], before: async p => { await p.click('[data-act=start-cook]'); await p.waitForSelector('.overlay.in .sheet'); }, check: async p => { const f = []; if ((await p.evaluate(count, '.radio-list label')) < 5) f.push('the new cook sheet does not list the plans'); if (!(await p.evaluate(count, 'select[data-role]'))) f.push('no probe assignment'); if (!(await p.evaluate(count, '#add-tell'))) f.push('no "tell me at" line'); return f; } },
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

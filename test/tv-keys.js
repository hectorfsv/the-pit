#!/usr/bin/env node
/* The remote on The Pit, in Chromium (the stick's WebView is Chromium 138). Hubs hands every page but the HUB the arrows as
   Tab and Shift+Tab, Select as Enter, and Back as history back: this presses exactly those, on the sample cooks.
     node test/tv-keys.js --base http://127.0.0.1:8765/   (run.sh serves the folder and calls this) */
const path = require('path'), os = require('os');
const { chromium } = require(path.join(__dirname, '..', '..', '..', 'webkit-check', 'node_modules', 'playwright'));
const args = process.argv.slice(2), BASE = args[args.indexOf('--base') + 1], OUT = path.join(__dirname, 'shots');
const SHELL = path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-x64/chrome-headless-shell');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL ' + m); } };
const here = p => p.evaluate(() => { const a = document.activeElement; return { act: a.dataset.act || a.dataset.tab || a.id || a.className || a.tagName, inSheet: !!a.closest('.sheet'), body: a === document.body, bar: !!a.closest('.bottom'), text: a.textContent.trim().slice(0, 40) }; });
const open = async (browser, url) => {
  const ctx = await browser.newContext({ viewport: { width: 1443, height: 812 }, deviceScaleFactor: 1.33, hasTouch: false });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + url, { waitUntil: 'load' }); await page.waitForTimeout(500);
  await page.evaluate(() => { const b = document.querySelector('#demobar'); if (b) b.style.display = 'none'; });
  return { ctx, page, errors };
};
(async () => {
  const browser = await chromium.launch({ executablePath: SHELL, args: ['--mute-audio'] });
  { // the walk: from the first ring to every thing he can press, and each one in sight when the ring lands on it
    const { ctx, page, errors } = await open(browser, 'index.html?demo=brisket&tv=1#now');
    const first = await here(page);
    ok(first.act === 'set-pit' && !first.bar, `the ring starts on the Pit's Set temp, got ${JSON.stringify(first)}`);
    const seen = [], hidden = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab'); await page.waitForTimeout(30);
      const h = await here(page); seen.push(h.act);
      const under = await page.evaluate(() => { const a = document.activeElement, r = a.getBoundingClientRect(), b = document.querySelector('.bottom').getBoundingClientRect(); return !a.closest('.bottom') && r.top >= b.top; });
      if (under) hidden.push(h.act);
    }
    for (const want of ['tile', 'expand', 'points', 'next', 'pause', 'done', 'now', 'plans', 'history', 'alerts']) ok(seen.includes(want), `the arrows reach ${want}: ${seen.join(' ')}`);
    ok(!hidden.length, `the ring is never under the bar: ${hidden.join(' ')}`);
    const spots = await page.evaluate(() => [...document.querySelectorAll('.now .steps ol,.now .log ul,.now .sensors')].every(e => e.tabIndex === 0));
    ok(spots, 'the sections with nothing to press still take the ring');
    await page.keyboard.press('Shift+Tab'); const back = await here(page); ok(!back.body, 'Up walks back');
    ok(!errors.length, 'no page errors: ' + errors.join(' | ')); await ctx.close();
  }
  { // a new reading rebuilds the screen: his place stays
    const { ctx, page } = await open(browser, 'index.html?demo=brisket&tv=1#now');
    for (const [sel, name] of [['.bottom [data-act=pause]', 'Pause in the bar'], ['.bottom [data-act=set]', 'Set pit in the bar'], ['#main [data-act=tile]', 'a thermometer tile'], ['#main [data-act=set-pit]', "the tile's Set temp"], ['.tabs [data-tab=alerts]', 'the Alerts tab']]) {
      await page.focus(sel); const before = await page.evaluate(s => document.activeElement === document.querySelector(s), sel);
      await page.evaluate(() => renderAll());
      ok(before && await page.evaluate(s => document.activeElement === document.querySelector(s), sel), `the ring stays on ${name} through a redraw`);
    }
    await ctx.close();
  }
  { // a sheet owns the remote; Back closes it and his place comes back
    const { ctx, page, errors } = await open(browser, 'index.html?demo=brisket&tv=1#now');
    const hash = await page.evaluate(() => location.hash);
    await page.keyboard.press('Enter'); await page.waitForTimeout(350);
    ok(await page.$('#sheet-root .overlay'), 'Select on Set temp opens the sheet');
    ok((await here(page)).inSheet, 'the ring is inside the sheet');
    await page.screenshot({ path: path.join(OUT, 'tv-sheet-tv.png') });
    let left = 0; for (let i = 0; i < 16; i++) { await page.keyboard.press(i % 3 ? 'Tab' : 'Shift+Tab'); if (!(await here(page)).inSheet) left++; }
    ok(!left, `the arrows never leave the sheet (${left} times out)`);
    await page.goBack(); await page.waitForTimeout(350);
    ok(!(await page.$('#sheet-root .overlay')), 'Back closes the sheet');
    ok((await here(page)).act === 'set-pit', 'the ring is back on Set temp');
    ok(await page.evaluate(() => location.hash) === hash, 'Back stayed on the page');
    await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    await page.evaluate(() => closeSheet()); await page.waitForTimeout(350);
    ok(await page.evaluate(() => !TVS.open && !TVS.popping), 'a sheet closed by its own button leaves no step for Back');
    ok(await page.evaluate(() => !document.querySelector('#sheet-root .overlay')), 'it stays closed');
    ok(!errors.length, 'no page errors: ' + errors.join(' | ')); await ctx.close();
  }
  { // no hold on a remote: two presses, and one alone does nothing
    const { ctx, page, errors } = await open(browser, 'index.html?demo=brisket&tv=1#now');
    await page.focus('.bottom [data-act=done]'); await page.keyboard.press('Enter'); await page.waitForTimeout(350);
    const hint = await page.textContent('.hold-hint'); ok(/press twice/.test(hint), `the sheet says press twice, got ${hint}`);
    await page.focus('#sheet-go'); const word = await page.textContent('#sheet-go .lbl');
    await page.keyboard.press('Enter'); await page.waitForTimeout(60);
    ok(/Press again/.test(await page.textContent('#sheet-go .lbl')), 'one Select arms it');
    await page.waitForTimeout(4200);
    ok(await page.textContent('#sheet-go .lbl') === word, 'nothing more: it disarms by itself, nothing sent');
    await page.keyboard.press('Enter'); await page.waitForTimeout(40); await page.keyboard.press('Shift+Tab'); await page.waitForTimeout(40);
    ok(await page.textContent('#sheet-go .lbl') === word, 'walking away disarms it');
    await page.focus('#sheet-go'); await page.keyboard.press('Enter'); await page.waitForTimeout(60); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
    const fired = await page.evaluate(() => { const b = document.querySelector('#sheet-go'), t = document.querySelector('.toast'); return !b || !!t; });
    ok(fired, 'the second Select sends it');
    ok(!errors.length, 'no page errors: ' + errors.join(' | ')); await ctx.close();
  }
  { // a Select held a moment long is one press: it must not press the first button in the sheet it opened
    const { ctx, page } = await open(browser, 'index.html?demo=brisket&tv=1#now');
    await page.keyboard.down('Enter'); await page.waitForTimeout(350);
    for (let i = 0; i < 4; i++) { await page.keyboard.down('Enter'); await page.waitForTimeout(60); }
    await page.keyboard.up('Enter'); await page.waitForTimeout(150);
    const open1 = await page.$('#sheet-root .overlay'); ok(open1, 'a held Select opens the sheet once');
    ok(await page.evaluate(() => /Set temp|Set pit/i.test(document.querySelector('.sheet h2').textContent)), 'and stays on that sheet');
    await ctx.close();
  }
  { // the tabs, and a button that leaves the sheet for another page
    const { ctx, page, errors } = await open(browser, 'index.html?demo=open&plug=2&tv=1#now');
    await page.focus('.tabs [data-tab=plans]'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    ok(await page.evaluate(() => location.hash === '#plans'), 'Select on Plans goes there');
    ok(!(await here(page)).body, 'the ring lands on the new page');
    await page.goBack(); await page.waitForTimeout(300);
    ok(await page.evaluate(() => location.hash === '#now'), 'Back returns to Now');
    await page.evaluate(() => { openSheet({ title: 'x', body: '<button type="button" id="b">b</button>' }); }); await page.waitForTimeout(200);
    await page.evaluate(() => go('plans')); await page.waitForTimeout(350);
    ok(await page.evaluate(() => location.hash === '#plans' && !TVS.open && !TVS.popping && !document.querySelector('#sheet-root .overlay')), 'going to a page from a sheet closes it and lands there');
    ok(!errors.length, 'no page errors: ' + errors.join(' | ')); await ctx.close();
  }
  { // the phone never sees any of it
    const { ctx, page } = await open(browser, 'index.html?demo=brisket#now');
    ok(await page.evaluate(() => !document.documentElement.classList.contains('tv') && document.activeElement === document.body), 'without a stick: no tv class, no ring');
    ok(await page.evaluate(() => /^[A-Z][a-z]{2} \d+, /.test(fmtStamp(S.now() - 26 * 3600e3)) && !/,/.test(fmtStamp(S.now()))), 'an old read carries its day, today only the clock');
    ok(await page.evaluate(() => labelOf('m1') === 'Meater' && labelOf('p2') === 'Probe 2'), "the Meater's tile says Meater");
    await ctx.close();
  }
  await browser.close();
  console.log(`\n  the remote: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL threw: ' + e.message); process.exit(1); });

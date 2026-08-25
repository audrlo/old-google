#!/usr/bin/env node
/**
 * Run the extension against a REAL saved Google results page.
 *
 * Google serves a CAPTCHA to automated browsers, so the live DOM has to be
 * captured by hand (see README, "Capturing a real SERP"). This takes that saved
 * file, strips its scripts so nothing phones home or re-renders, injects the
 * extension exactly as Chrome would, and reports what actually matched.
 *
 *   node tools/diagnose.js demo/live-serp.html
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('../test/node_modules/playwright');

const ROOT = path.join(__dirname, '..');
const input = process.argv[2] || path.join(ROOT, 'demo', 'live-serp.html');
if (!fs.existsSync(input)) {
  console.error('No such file: ' + input + '\nSee README → "Capturing a real SERP".');
  process.exit(1);
}

const CSS = ['hide-ai.css', 'theme-2020.css', 'snippet.css'];
const JS = ['00-state.js', '10-purge.js', '20-extract.js', '30-snippet.js', '40-theme.js'];

let html = fs.readFileSync(input, 'utf8');
// Inert: no Google JS runs, nothing is fetched, the DOM stays exactly as captured.
html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
html = html.replace(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi, (m) =>
  /https?:/i.test(m) ? '' : m
);

const head = CSS.map((f) => `<link rel="stylesheet" href="${path.join(ROOT, 'src/content', f)}">`).join('\n');
const boot = `
<script>
window.chrome = {
  storage: { sync:{get:async()=>({}),set:async()=>{}}, local:{get:async()=>({}),set:async()=>{}}, onChanged:{addListener(){}} },
  runtime: { lastError:null, sendMessage(m,cb){ setTimeout(()=>cb({ok:false,error:'offline'}),30); } },
};
</script>
${JS.map((f) => `<script src="${path.join(ROOT, 'src/content', f)}"></script>`).join('\n')}
<script>
const OG = window.OG;
OG.settings.debug = true;
OG.isSearchPage = () => true;
OG.isResultsPage = () => true;
OG.query = () => ${JSON.stringify(process.argv[3] || 'what does a gazelle eat')};
OG.startIndex = () => 0;
OG.applyClasses(); OG.purgeAI(); OG.theme(); OG.buildPagination(); OG.ensureSnippet();
window.__ready = true;
</script>`;

html = html.replace(/<\/head>/i, head + '</head>');
html = html.replace(/<\/body>/i, boot + '</body>');

const tmp = path.join(os.tmpdir(), 'og-diagnose.html');
fs.writeFileSync(tmp, html);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 2 });
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
  await page.goto('file://' + tmp);
  await page.waitForFunction(() => window.__ready === true).catch(() => {});
  await page.waitForTimeout(600);

  const report = await page.evaluate(() => {
    const name = (n) => (!n ? null : n.id ? '#' + n.id : n.tagName.toLowerCase() + '.' + String(n.className).split(/\s+/).filter(Boolean).slice(0, 3).join('.'));
    const geo = (n) => { if (!n) return null; const b = n.getBoundingClientRect(); return { left: Math.round(b.left), top: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
    const one = (sel) => document.querySelector(sel);

    const pills = Array.from(document.querySelectorAll('form *, #searchform *')).filter((n) => {
      const cs = getComputedStyle(n);
      return n.checkVisibility() && parseFloat(cs.borderTopWidth) > 0 && parseFloat(cs.borderTopLeftRadius) >= 12;
    });

    return {
      searchBox: { el: name(one('.og-searchbox')), geo: geo(one('.og-searchbox')) },
      pillsFound: pills.map((n) => ({ el: name(n), geo: geo(n) })),
      tabs: { el: name(one('.og-tabs')), geo: geo(one('.og-tabs')) },
      tabBar: { el: name(one('.og-tabbar')), geo: geo(one('.og-tabbar')) },
      offset: { el: name(one('.og-offset')), geo: geo(one('.og-offset')) },
      centerCol: geo(one('#center_col')),
      rhs: geo(one('#rhs')),
      results: document.querySelectorAll('.og-result').length,
      firstResult: (() => {
        const r = document.querySelector('.og-result');
        if (!r) return null;
        return {
          title: (r.querySelector('h3') || {}).textContent,
          cite: (r.querySelector('cite') || {}).textContent,
          snippet: ((r.querySelector('.og-snippet') || {}).textContent || '').slice(0, 120),
        };
      })(),
      card: (() => {
        const c = document.getElementById('og-featured');
        if (!c) return null;
        return { text: (c.querySelector('.og-fs-answer') || {}).textContent?.slice(0, 140), note: (c.querySelector('.og-fs-note') || {}).textContent, geo: geo(c) };
      })(),
      hidden: Array.from(document.querySelectorAll('[data-og-hidden]')).map((n) => ({ why: n.getAttribute('data-og-hidden'), el: name(n), geo: geo(n) })),
      aiLeft: !!one('[data-subtree="aio"]')?.checkVisibility?.(),
    };
  });

  console.log(JSON.stringify(report, null, 2));
  if (logs.length) console.log('\n--- console ---\n' + logs.join('\n'));

  const out = path.join(ROOT, 'demo', 'live-diagnose.png');
  await page.screenshot({ path: out, fullPage: false });
  console.log('\nscreenshot: ' + out);
  await browser.close();
})();

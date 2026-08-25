const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewportSize: { width: 1440, height: 1100 }, deviceScaleFactor: 2 });
  const logs = [];
  page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));

  await page.goto('file://' + path.join(__dirname, '..', 'demo', 'serp.html'));
  await page.waitForTimeout(600);

  const report = await page.evaluate(() => ({
    aiVisible: !!document.querySelector('[data-subtree="aio"]')?.checkVisibility?.(),
    aiModeTabVisible: !!Array.from(document.querySelectorAll('#hdtb-msb a')).find(
      (a) => a.textContent.trim() === 'AI Mode' && a.checkVisibility()
    ),
    featured: !!document.getElementById('og-featured'),
    featuredKind: document.querySelector('.og-fs-list') ? 'list' : document.querySelector('.og-fs-table') ? 'table' : 'paragraph',
    featuredText: document.querySelector('.og-fs-answer')?.textContent.slice(0, 90),
    featuredBold: document.querySelector('.og-fs-answer b')?.textContent.slice(0, 60),
    featuredCite: document.querySelector('.og-fs-cite')?.textContent,
    pager: !!document.getElementById('og-pager-wrap'),
    pagerPages: Array.from(document.querySelectorAll('.og-pager-num')).map((n) => n.textContent).join(','),
    pagerCurrent: document.querySelector('.og-pager-current .og-pager-num')?.textContent,
    results: document.querySelectorAll('.og-result').length,
    titleColor: getComputedStyle(document.querySelector('.og-title')).color,
    titleSize: getComputedStyle(document.querySelector('.og-title')).fontSize,
    snippetColor: getComputedStyle(document.querySelector('.og-snippet')).color,
    fontFamily: getComputedStyle(document.querySelector('.og-title')).fontFamily,
    centerColWidth: getComputedStyle(document.getElementById('center_col')).width,
  }));

  console.log(JSON.stringify(report, null, 2));
  if (logs.length) console.log('\n--- console ---\n' + logs.join('\n'));

  await page.screenshot({ path: path.join(__dirname, '..', 'demo', 'preview.png'), fullPage: true });
  await browser.close();
})();

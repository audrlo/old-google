/* Images / Videos / Shopping have nothing like the 652px text column. Forcing
 * the 2020 geometry on them pushed the grid sideways off the page. The skin's
 * typography still applies; only the column layout is withheld.
 */
const { chromium } = require('playwright');
const path = require('path');

const base = 'file://' + path.join(__dirname, '..', 'demo', 'serp-images.html');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '\n         ' + JSON.stringify(detail) : '')); }
}

(async () => {
  const browser = await chromium.launch();

  for (const [label, query] of [['Images (udm=2)', '?udm=2'], ['Videos (udm=7)', '?udm=7'], ['legacy tbm=isch', '?tbm=isch']]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(base + query);
    await page.waitForFunction(() => window.__ready === true);
    await page.waitForTimeout(200);
    const r = await page.evaluate(() => ({
      isWebTab: window.OG.isWebTab(),
      hasWebClass: document.documentElement.classList.contains('og-web'),
      hasThemeClass: document.documentElement.classList.contains('og-2020'),
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      tabsLeft: (() => {
        const a = Array.from(document.querySelectorAll('#hdtb-msb a'))
          .find((n) => n.checkVisibility() && n.getBoundingClientRect().width > 8);
        return a ? Math.round(a.getBoundingClientRect().left) : null;
      })(),
      tabRuleLeft: Math.round(document.getElementById('tabrow').getBoundingClientRect().left),
      tabRuleWidth: Math.round(document.getElementById('tabrow').getBoundingClientRect().width),
      colWidth: getComputedStyle(document.getElementById('center_col')).width,
      gridRight: Math.round(document.getElementById('islrg').getBoundingClientRect().right),
      pager: !!document.getElementById('og-pager-wrap'),
      aiTab: !!Array.from(document.querySelectorAll('#hdtb-msb a')).find((a) => a.textContent === 'AI Mode' && a.checkVisibility()),
      headerHooks: ['.og-searchbox', '.og-tabbar', '.og-nopill', '.og-tabs']
        .map((sel) => document.querySelectorAll(sel).length).reduce((a, b) => a + b, 0),
    }));

    console.log('\n' + label);
    check('not treated as the web tab', r.isWebTab === false && r.hasWebClass === false, r);
    check('no horizontal scrolling', r.scrollWidth <= r.clientWidth + 1, { scrollWidth: r.scrollWidth, clientWidth: r.clientWidth });
    check('the tab rule still spans the window', Math.abs(r.tabRuleWidth - r.clientWidth) <= 2 && r.tabRuleLeft === 0,
      { left: r.tabRuleLeft, width: r.tabRuleWidth, viewport: r.clientWidth });
    check('column is not squeezed to 652px', r.colWidth !== '652px', r.colWidth);
    check('grid stays inside the viewport', r.gridRight <= r.clientWidth + 1, { gridRight: r.gridRight, clientWidth: r.clientWidth });
    check('no numbered pager on this vertical', r.pager === false);
    check('AI Mode tab still removed', r.aiTab === false);
    check('header still left alone', r.headerHooks === 0, r.headerHooks);
    await page.close();
  }

  // and the All tab in the same fixture shape still gets the full treatment
  const web = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await web.goto(base);
  await web.waitForFunction(() => window.__ready === true);
  await web.waitForTimeout(200);
  const w = await web.evaluate(() => {
    const a = Array.from(document.querySelectorAll('#hdtb-msb a'))
      .find((n) => n.checkVisibility() && n.getBoundingClientRect().width > 8);
    const row = document.getElementById('tabrow').getBoundingClientRect();
    return {
      isWebTab: window.OG.isWebTab(),
      hasWebClass: document.documentElement.classList.contains('og-web'),
      tabsLeft: a ? Math.round(a.getBoundingClientRect().left) : null,
      tabRuleLeft: Math.round(row.left),
      tabRuleWidth: Math.round(row.width),
      colLeft: Math.round(document.getElementById('center_col').getBoundingClientRect().left),
      gutter: getComputedStyle(document.documentElement).getPropertyValue('--og-gutter').trim(),
      tabTextLeft: a ? Math.round(a.getBoundingClientRect().left + parseFloat(getComputedStyle(a).paddingLeft)) : null,
      clientWidth: document.documentElement.clientWidth,
    };
  });
  console.log('\nAll tab (no udm) is unaffected');
  check('still treated as the web tab', w.isWebTab === true && w.hasWebClass === true, w);
  check('the results column lines up with the tab text', w.colLeft === w.tabTextLeft, {
    column: w.colLeft, tabText: w.tabTextLeft, gutter: w.gutter,
  });
  check('the tab rule spans the window here too',
    w.tabRuleLeft === 0 && Math.abs(w.tabRuleWidth - w.clientWidth) <= 2,
    { left: w.tabRuleLeft, width: w.tabRuleWidth, viewport: w.clientWidth });

  /* The complaint that started this: switching to Images moved the whole
   * header sideways, because the gutter was padding on a container the tab
   * strip lived inside. */
  const img = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await img.goto(base + '?udm=2');
  await img.waitForFunction(() => window.__ready === true);
  await img.waitForTimeout(150);
  const i = await img.evaluate(() => {
    const a = Array.from(document.querySelectorAll('#hdtb-msb a'))
      .find((n) => n.checkVisibility() && n.getBoundingClientRect().width > 8);
    return { tabsLeft: a ? Math.round(a.getBoundingClientRect().left) : null };
  });
  await img.close();
  check('the tab strip does not move between All and Images', w.tabsLeft === i.tabsLeft, {
    all: w.tabsLeft, images: i.tabsLeft,
  });
  await web.close();

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();

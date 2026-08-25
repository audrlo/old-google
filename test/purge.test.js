/* Regression test for the live-Google breakage:
 *   - a recycled obfuscated class on a header container blanked the whole top
 *     of the page, so the search box could not be used
 *   - an empty #rhs drew a hairline across the results
 * Runs the real CSS + JS in real Chromium against demo/serp-hostile.html.
 */
const { chromium } = require('playwright');
const path = require('path');

const url = 'file://' + path.join(__dirname, '..', 'demo', 'serp-hostile.html');

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '\n         ' + JSON.stringify(detail) : '')); }
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(url + '?footer=show');
  await page.waitForFunction(() => window.__ready === true);
  await page.waitForTimeout(300);

  const r = await page.evaluate(() => {
    const vis = (sel) => {
      const n = document.querySelector(sel);
      return !!(n && n.checkVisibility());
    };
    const rect = (sel) => {
      const n = document.querySelector(sel);
      if (!n || !n.checkVisibility()) return null;
      const b = n.getBoundingClientRect();
      return { w: Math.round(b.width), h: Math.round(b.height) };
    };
    // Any visible element that is a thin full-width horizontal rule = the bug.
    const hairlines = Array.from(document.querySelectorAll('#rhs *, #rhs')).filter((n) => {
      if (!n.checkVisibility()) return false;
      const b = n.getBoundingClientRect();
      const cs = getComputedStyle(n);
      return b.height <= 3 && b.width > 200 && parseFloat(cs.borderTopWidth) > 0;
    }).length;

    return {
      searchBox: vis('input[name="q"]'),
      searchBoxSize: rect('input[name="q"]'),
      logo: vis('#logo'),
      tabsAll: vis('#hdtb-msb a[aria-current="page"]'),
      tabsImages: !!Array.from(document.querySelectorAll('#hdtb-msb a')).find((a) => a.textContent === 'Images' && a.checkVisibility()),
      aiModeTab: !!Array.from(document.querySelectorAll('#hdtb-msb a')).find((a) => a.textContent === 'AI Mode' && a.checkVisibility()),
      aiOverview: vis('[data-subtree="aio"]'),
      results: document.querySelectorAll('.og-result').length,
      resultTitles: Array.from(document.querySelectorAll('.og-result h3')).filter((h) => h.checkVisibility()).length,
      siteName: !!Array.from(document.querySelectorAll('.VuuXrf')).find((n) => n.checkVisibility()),
      cite: !!Array.from(document.querySelectorAll('.og-result cite')).find((n) => n.checkVisibility()),
      favPlate: (() => {
        const n = document.querySelector('.favplate');
        if (!n) return null;
        const cs = getComputedStyle(n);
        return { border: cs.borderTopWidth, radius: cs.borderTopLeftRadius, bg: cs.backgroundColor };
      })(),
      favSized: (() => {
        const n = document.querySelector('.og-favicon');
        if (!n) return null;
        const b = n.getBoundingClientRect();
        return { w: Math.round(b.width), h: Math.round(b.height) };
      })(),
      paaBox: (() => {
        const n = document.getElementById('paa');
        if (!n) return null;
        const cs = getComputedStyle(n);
        return { border: cs.borderTopWidth, radius: cs.borderTopLeftRadius };
      })(),
      cardText: (() => {
        const n = document.querySelector('#og-featured .og-fs-answer');
        return n ? n.textContent.trim() : null;
      })(),
      aboutMenu: !!Array.from(document.querySelectorAll('[aria-label="About this result"]')).find((n) => n.checkVisibility()),
      rhsVisible: vis('#rhs'),
      hairlines,
      pager: vis('#og-pager-wrap'),

      // the header must come out of this byte-for-byte unstyled.
      headerHooks: ['.og-searchbox', '.og-tabbar', '.og-nopill', '.og-tabs']
        .map((sel) => [sel, document.querySelectorAll(sel).length])
        .filter(([, n]) => n > 0),
      googlePill: (() => {
        const n = document.getElementById('megapill');
        if (!n) return null;
        const cs = getComputedStyle(n);
        return { border: cs.borderTopWidth, radius: cs.borderTopLeftRadius, w: Math.round(n.getBoundingClientRect().width) };
      })(),
      googleTabRule: (() => {
        const n = document.getElementById('tabrow');
        if (!n) return null;
        const cs = getComputedStyle(n);
        const b = n.getBoundingClientRect();
        return { border: cs.borderBottomWidth, color: cs.borderBottomColor, w: Math.round(b.width) };
      })(),
      tabLinkColor: getComputedStyle(document.querySelector('#hdtb-msb a')).color,
      colLeft: Math.round(document.getElementById('center_col').getBoundingClientRect().left),
      tabTextLeft: (() => {
        const a = Array.from(document.querySelectorAll('#hdtb-msb a'))
          .find((n) => n.checkVisibility() && n.getBoundingClientRect().width > 8);
        if (!a) return null;
        return Math.round(a.getBoundingClientRect().left + parseFloat(getComputedStyle(a).paddingLeft));
      })(),
      gutter: getComputedStyle(document.documentElement).getPropertyValue('--og-gutter').trim(),
      tabRule: (() => {
        const n = document.getElementById('tabrow');
        const b = n.getBoundingClientRect();
        return { left: Math.round(b.left), width: Math.round(b.width) };
      })(),
      viewportWidth: document.documentElement.clientWidth,
      footText: (() => {
        const n = document.getElementById('footcnt');
        if (!n || !n.checkVisibility()) return null;
        return { left: Math.round(n.getBoundingClientRect().left) };
      })(),

      // the footer must be a full-width bar below everything, not a box beside it.
      foot: (() => {
        const f = document.getElementById('foot');
        if (!f || !f.checkVisibility()) return null;
        const b = f.getBoundingClientRect();
        const last = document.querySelectorAll('.og-result');
        const lastBottom = last.length ? last[last.length - 1].getBoundingClientRect().bottom : 0;
        return {
          left: Math.round(b.left),
          width: Math.round(b.width),
          belowResults: b.top >= lastBottom - 1,
        };
      })(),
    };
  });

  console.log('\nthe two bugs from the screenshots');
  check('search box is usable', r.searchBox && r.searchBoxSize && r.searchBoxSize.h > 10, r.searchBoxSize);
  check('logo is visible', r.logo);
  check('tab strip survived (All)', r.tabsAll);
  check('tab strip survived (Images)', r.tabsImages);
  check('no stray hairline from an empty #rhs', r.hairlines === 0, r.hairlines);
  check('empty #rhs is removed from layout', r.rhsVisible === false);

  console.log('\nAI removal still works');
  check('AI Overview is gone', r.aiOverview === false);
  check('AI Mode tab is gone', r.aiModeTab === false);

  console.log('\nresults are intact and 2020-shaped');
  check('both results present', r.results === 2, r.results);
  check('both titles visible', r.resultTitles === 2, r.resultTitles);
  check('URL breadcrumb kept', r.cite);
  check('stacked site name collapsed', r.siteName === false);
  check('"About this result" menu hidden', r.aboutMenu === false);
  check('pager built', r.pager);
  check('no plate around the favicon', r.favPlate && r.favPlate.border === '0px' && r.favPlate.radius === '0px', r.favPlate);
  check('favicon is a bare 16px icon', r.favSized && r.favSized.w === 16 && r.favSized.h === 16, r.favSized);
  check('no box around "People also ask"', r.paaBox && r.paaBox.border === '0px' && r.paaBox.radius === '0px', r.paaBox);
  check('snippet text is prose, not scraped page furniture',
    r.cardText === null || (!r.cardText.includes('://') && !r.cardText.includes('Gazelle Eating HabitsSquaw')),
    r.cardText && r.cardText.slice(0, 90));

  console.log('\nthe header is left entirely alone');
  check('no extension hooks in the header at all', r.headerHooks.length === 0, r.headerHooks);
  check("Google's search pill is untouched",
    r.googlePill && r.googlePill.border === '1px' && r.googlePill.radius === '24px' && r.googlePill.w > 900, r.googlePill);
  check("Google's rule under the tabs is untouched",
    r.googleTabRule && r.googleTabRule.border === '1px' && r.googleTabRule.color === 'rgb(235, 235, 235)', r.googleTabRule);
  check('the results column lines up with the tab text', r.colLeft === r.tabTextLeft,
    { column: r.colLeft, tabText: r.tabTextLeft });
  check('a hidden link in the nav does not collapse the gutter to 0',
    r.colLeft > 0 && r.gutter !== '0px', { column: r.colLeft, gutter: r.gutter });
  check("Google's tab rule starts at the window edge, not at the gutter",
    r.tabRule.left === 0 && Math.abs(r.tabRule.width - r.viewportWidth) <= 2, r.tabRule);
  check('that rule still spans the window',
    r.googleTabRule && Math.abs(r.googleTabRule.w - r.viewportWidth) <= 4, { w: r.googleTabRule && r.googleTabRule.w, viewportWidth: r.viewportWidth });
  check('tab links keep their own colour (browser default here, Google\'s on the real page)',
    r.tabLinkColor === 'rgb(0, 0, 238)', r.tabLinkColor);

  console.log('\nfooter');
  check('footer is a full-width bar', r.foot && r.foot.left === 0 && Math.abs(r.foot.width - r.viewportWidth) <= 4, r.foot);
  check('footer sits below the results, not beside them', r.foot && r.foot.belowResults, r.foot);
  check('footer text is not pushed off-screen', r.footText && r.footText.left >= 0, r.footText);

  console.log('\nfooter can be switched off (the default)');
  const off = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await off.goto(url);
  await off.waitForFunction(() => window.__ready === true);
  await off.waitForTimeout(200);
  const hidden = await off.evaluate(() => {
    const f = document.getElementById('foot');
    const c = document.getElementById('footcnt');
    const q = document.querySelector('input[name="q"]');
    return {
      footGone: !f || !f.checkVisibility(),
      textGone: !c || !c.checkVisibility(),
      titles: document.querySelectorAll('.og-result h3').length,
      searchBox: !!(q && q.checkVisibility()),
    };
  });
  await off.close();
  check('footer bar is gone by default', hidden.footGone, hidden);
  check('the personalization line goes with it', hidden.textGone, hidden);
  check('nothing else is taken with it', hidden.titles === 2 && hidden.searchBox, hidden);

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();

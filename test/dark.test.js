/* Dark mode.
 *
 * The skin used to force white backgrounds while leaving Google's light-grey
 * text alone, which made whole sections — "People also ask" worst of all —
 * effectively invisible. So this measures the thing that was actually broken:
 * the contrast ratio between each piece of text and the background behind it.
 */
const { chromium } = require('playwright');
const path = require('path');

const base = 'file://' + path.join(__dirname, '..', 'demo', 'serp-hostile.html');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '\n         ' + JSON.stringify(detail) : '')); }
}

/* Runs in the page: WCAG contrast between an element's text and whatever is
 * actually painted behind it. */
const PROBE = () => {
  const lum = (css) => {
    const m = /rgba?\(([^)]+)\)/.exec(css || '');
    if (!m) return null;
    const p = m[1].split(',').map(parseFloat);
    if (p.length > 3 && p[3] === 0) return null;
    const ch = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * ch(p[0]) + 0.7152 * ch(p[1]) + 0.0722 * ch(p[2]);
  };
  const behind = (el) => {
    let n = el;
    while (n) {
      const l = lum(getComputedStyle(n).backgroundColor);
      if (l !== null) return l;
      n = n.parentElement;
    }
    return lum(getComputedStyle(document.body).backgroundColor) ?? 1;
  };
  const ratio = (sel) => {
    const el = document.querySelector(sel);
    if (!el || !el.checkVisibility()) return null;
    const fg = lum(getComputedStyle(el).color);
    const bg = behind(el);
    if (fg === null || bg === null) return null;
    const [hi, lo] = fg > bg ? [fg, bg] : [bg, fg];
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  };
  return {
    dark: document.documentElement.classList.contains('og-dark'),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    contrast: {
      snippetAnswer: ratio('.og-fs-answer'),
      snippetCite: ratio('.og-fs-cite'),
      snippetTitle: ratio('.og-fs-title h3'),
      snippetNote: ratio('.og-fs-note'),
      resultTitle: ratio('.og-result h3'),
      resultSnippet: ratio('.og-snippet'),
      resultCite: ratio('.og-result cite'),
      peopleAlsoAsk: ratio('#paa div'),
      pagerNumber: ratio('.og-pager-num'),
    },
  };
};

const AA = 4.5;      // WCAG AA for body text
const AA_LARGE = 3;  // AA for large text (the 20px titles, 30px pager glyphs)

(async () => {
  const browser = await chromium.launch();

  for (const [label, url, wantDark] of [
    ['light SERP', base + '?footer=show', false],
    ['dark SERP', base + '?footer=show&dark=1', true],
  ]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: wantDark ? 'dark' : 'light' });
    await page.goto(url);
    await page.waitForFunction(() => window.__ready === true);
    await page.waitForTimeout(250);
    const r = await page.evaluate(PROBE);

    console.log('\n' + label);
    check('dark mode ' + (wantDark ? 'detected' : 'not falsely detected'), r.dark === wantDark, { dark: r.dark, bodyBg: r.bodyBg });

    for (const [key, value] of Object.entries(r.contrast)) {
      const large = key === 'resultTitle' || key === 'snippetTitle' || key === 'pagerNumber';
      const floor = large ? AA_LARGE : AA;
      check(key + ' is readable (>= ' + floor + ':1)', value !== null && value >= floor, { ratio: value });
    }
    await page.close();
  }

  console.log('\nturning the setting off forces the light palette');
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' });
    await page.goto(base + '?dark=1');
    await page.waitForFunction(() => window.__ready === true);
    await page.evaluate(() => { window.OG.settings.followDark = false; window.OG.theme(); });
    await page.waitForTimeout(100);
    const off = await page.evaluate(() => document.documentElement.classList.contains('og-dark'));
    check('og-dark is removed when followDark is off', off === false);
    await page.close();
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();

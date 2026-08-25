/* Loads the unpacked extension into a real Chromium and points it at real
 * google.com, then reports what the extension actually matched on the live DOM.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const EXT = path.join(__dirname, '..');
const PROFILE = path.join(process.env.TMPDIR || '/tmp', 'og-live-profile');
const QUERY = process.argv[2] || 'what does a gazelle eat';

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    viewport: { width: 1440, height: 1000 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  await ctx.addCookies([
    { name: 'SOCS', value: 'CAESHAgBEhJnd3NfMjAyNDA1MDctMF9SQzIaAmVuIAEaBgiA_LyaBg', domain: '.google.com', path: '/' },
    { name: 'CONSENT', value: 'YES+cb', domain: '.google.com', path: '/' },
  ]);

  const page = ctx.pages()[0] || (await ctx.newPage());
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('https://www.google.com/search?hl=en&gl=us&q=' + encodeURIComponent(QUERY), {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(4000);

  const report = await page.evaluate(() => {
    const id = (n) => (n ? (n.id ? '#' + n.id : n.tagName.toLowerCase() + '.' + String(n.className).split(' ').slice(0, 2).join('.')) : null);
    const box = (n) => (n ? { w: Math.round(n.getBoundingClientRect().width), left: Math.round(n.getBoundingClientRect().left) } : null);

    const sb = document.querySelector('.og-searchbox');
    const tb = document.querySelector('.og-tabbar');

    // what each description selector actually matches on the top result
    const first = document.querySelector('#rso h3');
    const block = first && first.closest('div.g, div.MjjYud, div[data-hveid]');
    const descProbe = {};
    for (const sel of ['.VwiC3b', '[data-sncf]', '[data-snf]', '.lyLwlc', '.yDYNvb']) {
      const n = block && block.querySelector(sel);
      descProbe[sel] = n ? { tag: id(n), len: n.textContent.trim().length, text: n.textContent.trim().slice(0, 110) } : null;
    }

    const card = document.getElementById('og-featured');
    return {
      title: document.title,
      url: location.href,
      captcha: /sorry|unusual traffic/i.test(document.body.innerText.slice(0, 400)),
      searchBox: { el: id(sb), box: box(sb) },
      tabBar: { el: id(tb), box: box(tb) },
      results: document.querySelectorAll('.og-result').length,
      cardText: card ? (card.querySelector('.og-fs-answer') || {}).textContent?.slice(0, 130) : null,
      cardNote: card ? (card.querySelector('.og-fs-note') || {}).textContent : null,
      descProbe,
      hiddenCount: document.querySelectorAll('[data-og-hidden]').length,
      aiLeft: !!document.querySelector('[data-subtree="aio"]')?.checkVisibility?.(),
    };
  });

  console.log(JSON.stringify(report, null, 2));
  if (errors.length) console.log('\npage errors:\n' + errors.join('\n'));

  await page.screenshot({ path: path.join(EXT, 'demo', 'live.png'), fullPage: false });
  await ctx.close();
})();

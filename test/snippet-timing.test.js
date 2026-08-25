/* The featured snippet needs a network round trip to the source page. This
 * asserts the box does not sit empty while that happens: the top result's index
 * description is quoted immediately, then upgraded in place when the extracted
 * passage arrives.
 */
const { chromium } = require('playwright');
const path = require('path');

const url = 'file://' + path.join(__dirname, '..', 'demo', 'serp-hostile.html') + '?slow=1';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '\n         ' + JSON.stringify(detail) : '')); }
}

const read = () => {
  const card = document.getElementById('og-featured');
  if (!card) return null;
  return {
    text: (card.querySelector('.og-fs-answer') || {}).textContent || '',
    note: (card.querySelector('.og-fs-note') || {}).textContent || '',
    cite: (card.querySelector('.og-fs-cite') || {}).textContent || '',
  };
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  await page.goto(url);
  await page.waitForFunction(() => window.__ready === true);

  // The source fetch is stubbed to take 1500ms. Look well before that.
  await page.waitForTimeout(150);
  const early = await page.evaluate(read);

  console.log('\nwhile the source page is still being fetched');
  check('a card is already showing', !!early, early);
  check('it quotes the index description', !!early && /Gazelles are herbivores/.test(early.text), early && early.text.slice(0, 60));
  check('it is labelled as a description, not a snippet', !!early && early.note === 'Description from the web', early && early.note);
  check('it is attributed to the source', !!early && /squawmountainranch/.test(early.cite), early && early.cite);

  await page.waitForFunction(
    () => {
      const n = document.querySelector('#og-featured .og-fs-note');
      return n && n.textContent === 'Featured snippet from the web';
    },
    null,
    { timeout: 6000 }
  );
  const late = await page.evaluate(read);

  console.log('\nonce the passage has been extracted');
  check('the card upgraded in place', !!late && /19 different species/.test(late.text), late && late.text.slice(0, 60));
  check('it is now labelled a featured snippet', !!late && late.note === 'Featured snippet from the web', late && late.note);
  check('still exactly one card', await page.evaluate(() => document.querySelectorAll('#og-featured').length) === 1);
  check('same source as the stopgap', !!late && /squawmountainranch/.test(late.cite), late && late.cite);

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();

/* The featured snippet needs a network round trip to the source page plus a
 * pass of the model, so it cannot appear instantly.
 *
 * The box must not sit empty for long — but nor should it show one answer and
 * then rewrite itself under the reader. So Google's index description is held
 * back: it appears only once the real answer is clearly slow, and if the real
 * answer beats that delay it is the only thing ever shown.
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

  /* The stub delays the fetch by 1500ms, so no real answer can be ready yet.
   * Before the stopgap delay elapses nothing should be shown at all. */
  await page.waitForTimeout(250);
  const veryEarly = await page.evaluate(read);
  console.log('\nbefore the stopgap delay');
  check('nothing is shown yet, rather than a card that will rewrite itself', veryEarly === null, veryEarly);

  // ...and once it is clear the answer is slow, the description fills the gap.
  await page.waitForTimeout(700);
  const early = await page.evaluate(read);

  console.log('\nwhile the source page is still being fetched');
  check('the description fills the gap', !!early, early);
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

  /* The point of the delay: when the answer is quick, the reader never sees a
   * first answer replaced by a second one. Record every label the card has ever
   * carried, rather than sampling and hoping to catch a flicker. */
  console.log('\nwhen the answer is quick, nothing swaps');
  const fast = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await fast.addInitScript(() => {
    // An init script runs before document.documentElement exists, so a
    // MutationObserver cannot be attached here — it throws and the recorder
    // silently never starts. Polling needs nothing to be present yet.
    window.__notes = [];
    setInterval(() => {
      const n = document.querySelector('#og-featured .og-fs-note');
      const t = n && n.textContent;
      if (t && window.__notes[window.__notes.length - 1] !== t) window.__notes.push(t);
    }, 15);
  });
  await fast.goto('file://' + path.join(__dirname, '..', 'demo', 'serp-hostile.html') + '?fast=1');
  await fast.waitForFunction(() => window.__ready === true);
  await fast.waitForTimeout(1600);
  const notes = await fast.evaluate(() => window.__notes);
  const finalText = await fast.evaluate(read);
  await fast.close();

  check('the card was only ever rendered once, as the real snippet',
    notes.length === 1 && notes[0] === 'Featured snippet from the web', notes);
  check('the placeholder was never shown', !notes.includes('Description from the web'), notes);
  check('and it holds the extracted passage', finalText && /19 different species/.test(finalText.text),
    finalText && finalText.text.slice(0, 60));

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();

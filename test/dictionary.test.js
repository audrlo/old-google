/* The dictionary / thesaurus card: which queries trigger it, what it renders,
 * that it does not fire on ordinary searches, and how it looks in real
 * Chromium against demo/serp-dictionary.html (which stubs the two sources).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const SRC = path.join(__dirname, '..', 'src', 'content');
const dom = new JSDOM('<!doctype html><html><body><div id="rso"></div></body></html>', {
  url: 'https://www.google.com/search?q=gazelle+definition',
  runScripts: 'outside-only',
});
const win = dom.window;
win.chrome = {
  storage: { sync: { get: async () => ({}), set: async () => {} }, local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } },
  runtime: { lastError: null, sendMessage() {} },
};
for (const f of ['00-state.js', '25-dictionary.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), dom.getInternalVMContext(), { filename: f });
}
const OG = win.OG;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '\n         ' + JSON.stringify(detail) : '')); }
}

console.log('\nqueries that should open the card');
for (const [q, word, mode, opposite] of [
  ['gazelle definition', 'gazelle', 'define', false],
  ['define gazelle', 'gazelle', 'define', false],
  ['definition of gazelle', 'gazelle', 'define', false],
  ['what does gazelle mean', 'gazelle', 'define', false],
  ['gazelle meaning', 'gazelle', 'define', false],
  ['Define Ephemeral', 'ephemeral', 'define', false],
  ['synonyms for happy', 'happy', 'synonym', false],
  ['happy synonyms', 'happy', 'synonym', false],
  ['marvelous synonym', 'marvelous', 'synonym', false],
  ['another word for happy', 'happy', 'synonym', false],
  ['antonyms of happy', 'happy', 'synonym', true],
  ['happy antonym', 'happy', 'synonym', true],
  ['the meaning of serendipity', 'serendipity', 'define', false],
]) {
  const t = OG.dictionaryTarget(q);
  check(`"${q}" -> ${word} (${mode}${opposite ? ', opposite first' : ''})`,
    t && t.word === word && t.mode === mode && t.opposite === opposite, t);
}

console.log('\nqueries that should NOT');
for (const q of [
  'what does a gazelle eat',
  'gazelle',
  'best definition of insanity quote by einstein famous',
  'how to define a function in python',
  'nasa',
  '',
  'define',
]) {
  check(`"${q}" -> no card`, OG.dictionaryTarget(q) === null, OG.dictionaryTarget(q));
}

console.log('\npronunciation from ARPABET');
for (const [arpabet, ipa] of [
  ['HH AE1 P IY0', '/ˈhæpi/'],
  ['M AA1 R V AH0 L AH0 S', '/ˈmɑrvələs/'],
  ['G AH0 Z EH1 L', '/ɡəˈzɛl/'.replace('ɡ', 'g')],
  ['S EH2 R AH0 N D IH1 P AH0 T IY0', '/ˌsɛrənˈdɪpəti/'],
]) {
  check(arpabet + ' -> ' + ipa, OG.respell(arpabet) === ipa, OG.respell(arpabet));
}

const entry = {
  word: 'gazelle',
  phonetic: '/ɡəˈzɛl/',
  audio: '',
  credit: 'Definitions from Wiktionary · Synonyms from Datamuse',
  blocks: [
    { pos: 'noun', senses: [
      { text: 'Any of numerous antelopes of the genus Gazella, noted for their grace and speed.', example: 'a herd of gazelles' },
      { text: 'A light brown colour.', example: '' },
      { text: 'A third sense, hidden until "more definitions".', example: '' },
    ] },
    { pos: 'verb', senses: [{ text: 'To leap like a gazelle.', example: '' }] },
    { pos: 'adjective', senses: [{ text: 'A third part of speech, hidden too.', example: '' }] },
  ],
};

console.log('\nrendering');
{
  const panel = OG.renderDictionary({ word: 'gazelle', mode: 'define', opposite: false }, entry);
  const text = panel.textContent;
  check('heading', panel.querySelector('.og-dict-heading').textContent === 'Dictionary');
  check('word shown', panel.querySelector('.og-dict-word').textContent === 'gazelle');
  check('pronunciation shown', panel.querySelector('.og-dict-pron').textContent === '/ɡəˈzɛl/');
  check('part of speech shown', panel.querySelector('.og-dict-pos').textContent === 'noun');
  check('senses are a numbered list', panel.querySelectorAll('.og-dict-senses li').length === 5);
  check('third sense and third part of speech wait behind the footer link',
    panel.querySelectorAll('li.og-dict-extra').length === 1 && panel.querySelectorAll('.og-dict-block.og-dict-extra').length === 1);
  check('example is quoted', /"a herd of gazelles"/.test(text), text.slice(0, 200));
  check('Similar: and Opposite: rows sit under the first part of speech',
    panel.querySelector('.og-dict-block .og-dict-similar .og-dict-label').textContent === 'Similar:' &&
    panel.querySelector('.og-dict-block .og-dict-opposite .og-dict-label').textContent === 'Opposite:');
  check('a lone sense goes unnumbered, several are numbered',
    !panel.querySelectorAll('.og-dict-senses')[0].classList.contains('og-dict-single') && panel.querySelectorAll('.og-dict-senses')[1].classList.contains('og-dict-single'));
  check('attribution line under the heading, with a Learn more link',
    panel.querySelector('.og-dict-heading').nextElementSibling.classList.contains('og-dict-credit') &&
    panel.querySelector('.og-dict-credit').textContent === 'Definitions from Wiktionary · Synonyms from Datamuse · Learn more' &&
    panel.querySelector('.og-dict-credit a').href === 'https://github.com/audrlo/old-google#dictionary');
  check('credited once, not again at the bottom', panel.querySelectorAll('.og-dict-credit').length === 1 && !panel.querySelector('.og-dict-foot .og-dict-credit'));
  check('no search row', !panel.querySelector('.og-dict-search, input'));
  check('feedback link', panel.querySelector('.og-dict-feedback').href.includes('github.com/audrlo/old-google/issues'));

  const thes = OG.renderDictionary({ word: 'gazelle', mode: 'synonym', opposite: false }, entry);
  check('thesaurus heading', thes.querySelector('.og-dict-heading').textContent === 'Similar and opposite words');
  check('thesaurus has no speaker or pronunciation', !thes.querySelector('.og-dict-speak, .og-dict-pron'));
  check('thesaurus attribution line too', thes.querySelector('.og-dict-heading').nextElementSibling.classList.contains('og-dict-credit'));
  check('thesaurus shows one definition, no example', thes.querySelectorAll('.og-dict-def').length === 1 && !thes.querySelector('.og-dict-example'));
  check('Similar comes before Opposite', thes.querySelector('.og-dict-row').classList.contains('og-dict-similar'));
  const anti = OG.renderDictionary({ word: 'gazelle', mode: 'synonym', opposite: true }, entry);
  check('an antonym query leads with Opposite', anti.querySelector('.og-dict-row').classList.contains('og-dict-opposite'));

  let threw = false;
  try { OG.renderDictionary({ word: 'gazelle', mode: 'rhyme', opposite: false }, entry); } catch (_) { threw = true; }
  check('an unknown mode throws', threw);
}

console.log('\nnothing is rendered from untrusted markup');
{
  const nasty = {
    word: '<img src=x onerror=alert(1)>',
    phonetic: '<script>bad()</script>',
    audio: '',
  credit: 'Definitions from Wiktionary · Synonyms from Datamuse',
    blocks: [{ pos: 'noun', senses: [{ text: '<b>not bold</b>', example: '<i>x</i>' }] }],
  };
  const panel = OG.renderDictionary({ word: 'x', mode: 'define', opposite: false }, nasty);
  check('no elements injected from API strings', panel.querySelectorAll('img, script, b, i').length === 0,
    panel.innerHTML.slice(0, 160));
  check('API text is shown literally', panel.textContent.includes('<b>not bold</b>'));
}

/* Real Chromium: the demo stubs Wiktionary and Datamuse and answers a query
 * from ?q=. Style checks are the late-2023 metrics from dictionary.css. */
const { chromium } = require('playwright');
const demo = 'file://' + path.join(__dirname, '..', 'demo', 'serp-dictionary.html');

async function open(browser, qs, dark) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: dark ? 'dark' : 'light' });
  await page.goto(demo + qs);
  await page.waitForFunction(() => window.__ready === true);
  await page.waitForTimeout(100);
  return page;
}

(async () => {
  const browser = await chromium.launch();

  console.log('\ndefine card on a page');
  {
    const page = await open(browser, '', false);
    const r = await page.evaluate(() => {
      const d = document.getElementById('og-dictionary');
      const cs = getComputedStyle(d);
      const px = (sel, prop) => getComputedStyle(d.querySelector(sel))[prop];
      const similar = d.querySelector('.og-dict-similar .og-dict-chips');
      const chips = Array.from(similar.querySelectorAll('.og-dict-chip:not(.og-dict-caret)'));
      const caret = similar.querySelector('.og-dict-caret');
      return {
        border: cs.borderTopWidth, radius: cs.borderTopLeftRadius, bg: cs.backgroundColor, shadow: cs.boxShadow,
        width: Math.round(d.getBoundingClientRect().width),
        firstInRso: document.getElementById('rso').firstElementChild.id,
        snippetSuppressed: !document.getElementById('og-featured'),
        googleBoxHidden: !document.getElementById('google-dict-box').checkVisibility(),
        heading: px('.og-dict-heading', 'fontSize') + '/' + px('.og-dict-heading', 'lineHeight'),
        credit: d.querySelector('.og-dict-credit').textContent + ' ' + px('.og-dict-credit', 'fontSize') + ' ' + px('.og-dict-credit a', 'textDecorationLine'),
        searchRow: !!d.querySelector('.og-dict-search, input'),
        speaker: [px('.og-dict-speak', 'width'), px('.og-dict-speak span', 'width'), px('.og-dict-speak span', 'borderTopLeftRadius'), px('.og-dict-speak span', 'backgroundColor'), px('.og-dict-speak svg', 'fill'), px('.og-dict-speak svg', 'width')].join(' '),
        wordSize: px('.og-dict-word', 'fontSize') + '/' + px('.og-dict-word', 'lineHeight'),
        pron: d.querySelector('.og-dict-pron').textContent,
        pronColor: px('.og-dict-pron', 'color') === getComputedStyle(document.body).color,
        pos: d.querySelector('.og-dict-pos').textContent + ' ' + px('.og-dict-pos', 'fontStyle') + ' ' + px('.og-dict-pos', 'fontSize') + ' ' + px('.og-dict-pos', 'color'),
        senses: d.querySelectorAll('.og-dict-senses li').length,
        numbering: Array.from(d.querySelectorAll('.og-dict-senses')).map((ol) => ol.children.length + ':' + getComputedStyle(ol.firstElementChild).listStyleType).join(' '),
        example: d.querySelector('.og-dict-example').textContent,
        exampleColor: px('.og-dict-example', 'color'),
        similarLabel: px('.og-dict-similar .og-dict-label', 'color'),
        oppositeLabel: px('.og-dict-opposite .og-dict-label', 'color'),
        oppositeChips: d.querySelectorAll('.og-dict-opposite .og-dict-chip').length,
        chipCount: chips.length,
        chipStyle: [px('.og-dict-chip', 'height'), px('.og-dict-chip', 'fontSize'), px('.og-dict-chip', 'borderTopLeftRadius'), px('.og-dict-chip', 'color')].join(' '),
        clampedHeight: similar.clientHeight,
        caretOnFirstRow: !!caret && caret.offsetTop + caret.offsetHeight <= similar.clientHeight,
        hiddenChips: chips.filter((c) => c.offsetTop + c.offsetHeight > similar.clientHeight).length,
        extraHidden: !d.querySelector('.og-dict-block.og-dict-extra').checkVisibility(),
        more: d.querySelector('.og-dict-more').textContent,
        pill: [px('.og-dict-more', 'width'), px('.og-dict-more', 'height'), px('.og-dict-more', 'borderTopLeftRadius'), px('.og-dict-more', 'backgroundColor'), px('.og-dict-more', 'fontSize')].join(' '),
        pillOnRule: (() => {
          const pill = d.querySelector('.og-dict-more').getBoundingClientRect();
          const rule = d.querySelector('.og-dict-rule').getBoundingClientRect();
          return Math.round(pill.top + pill.height / 2 - rule.top) === 18 && Math.round(rule.width) === 652;
        })(),
        feedback: [px('.og-dict-feedback', 'fontSize'), px('.og-dict-feedback', 'fontStyle'), px('.og-dict-feedback', 'color')].join(' '),
        feedbackRight: Math.round(d.querySelector('.og-dict-feedback').getBoundingClientRect().right) === Math.round(d.getBoundingClientRect().right) - 16,
      };
    });
    check('a borderless block, not a card', r.border === '0px' && r.radius === '0px' && r.bg === 'rgba(0, 0, 0, 0)' && r.shadow === 'none', r);
    check('block is 652px like the column', r.width === 652, r.width);
    check('block sits above everything else', r.firstInRso === 'og-dictionary', r.firstInRso);
    check('featured snippet suppressed for a definition query', r.snippetSuppressed);
    check("Google's own dictionary box is hidden", r.googleBoxHidden);
    check('"Dictionary" heading at 22px/28px', r.heading === '22px/28px', r.heading);
    check('attribution line at 12px with an underlined Learn more', r.credit === 'Definitions from Wiktionary · Synonyms from Datamuse · Learn more 12px underline', r.credit);
    check('no search row', !r.searchRow);
    check('36px speaker button holding a filled 34px #4285f4 circle and a white 22px glyph', r.speaker === '36px 34px 50% rgb(66, 133, 244) rgb(255, 255, 255) 22px', r.speaker);
    check('word at 28px/36px', r.wordSize === '28px/36px', r.wordSize);
    check('pronunciation respelled from Datamuse, in the body colour', r.pron === '/ˈhæpi/' && r.pronColor, [r.pron, r.pronColor]);
    check('italic 14px #5e5e5e part of speech', r.pos === 'adjective italic 14px rgb(94, 94, 94)', r.pos);
    check('every sense listed (extras rendered but hidden)', r.senses === 7, r.senses);
    check('several senses numbered, a lone one not', r.numbering === '4:decimal 1:none 2:decimal', r.numbering);
    check('example in straight quotes, grey', r.example === '"Music makes me feel happy."' && r.exampleColor === 'rgb(94, 94, 94)', [r.example, r.exampleColor]);
    check('Similar: label is green, Opposite: label is red', r.similarLabel === 'rgb(24, 128, 56)' && r.oppositeLabel === 'rgb(217, 48, 37)', [r.similarLabel, r.oppositeLabel]);
    check('all synonyms rendered as chips', r.chipCount === 26, r.chipCount);
    check('antonym chips', r.oppositeChips === 4, r.oppositeChips);
    check('chip is 22px tall, 13px, pill, #202124', r.chipStyle === '22px 13px 32px rgb(32, 33, 36)', r.chipStyle);
    check('Similar row clamped to one 30px row', r.clampedHeight === 30, r.clampedHeight);
    check('caret pill sits on the first row after the last chip that fits', r.caretOnFirstRow && r.hiddenChips > 0, r);
    check('third part of speech hidden until expanded', r.extraHidden);
    check('footer pill reads "More definitions"', r.more === 'More definitions', r.more);
    check('pill is 300x36, 18px radius, #f1f3f4, 14px', r.pill === '300px 36px 18px rgb(241, 243, 244) 14px', r.pill);
    check('pill sits centred on a full-width rule', r.pillOnRule, r.pillOnRule);
    check('Feedback is 12px italic #5e5e5e, right-aligned', r.feedback === '12px italic rgb(94, 94, 94)' && r.feedbackRight, [r.feedback, r.feedbackRight]);

    await page.click('.og-dict-similar .og-dict-caret');
    await page.waitForTimeout(350); // the clamp releases over 0.3s
    const open1 = await page.evaluate(() => {
      const similar = document.querySelector('.og-dict-similar .og-dict-chips');
      const last = similar.querySelector('.og-dict-chip:last-child');
      return { open: similar.classList.contains('og-dict-open'), lastVisible: last.offsetTop + last.offsetHeight <= similar.clientHeight,
        flipped: getComputedStyle(similar.querySelector('.og-dict-caret svg')).transform !== 'none' };
    });
    check('clicking the caret shows every chip and flips the chevron', open1.open && open1.lastVisible && open1.flipped, open1);

    await page.click('.og-dict-more');
    const open2 = await page.evaluate(() => ({
      extraShown: document.querySelector('.og-dict-block.og-dict-extra').checkVisibility(),
      label: document.querySelector('.og-dict-more').textContent,
    }));
    check('the pill reveals the rest and reads "Show less"', open2.extraShown && open2.label === 'Show less', open2);
    await page.close();
  }

  console.log('\nthesaurus card for "marvelous synonym"');
  {
    const page = await open(browser, '?q=marvelous+synonym', false);
    const r = await page.evaluate(() => {
      const d = document.getElementById('og-dictionary');
      const px = (sel, prop) => getComputedStyle(d.querySelector(sel))[prop];
      const similar = d.querySelector('.og-dict-similar .og-dict-chips');
      const chips = Array.from(similar.querySelectorAll('.og-dict-chip:not(.og-dict-caret)'));
      return {
        variant: d.className,
        heading: d.querySelector('.og-dict-heading').textContent + ' ' + px('.og-dict-heading', 'fontSize') + ' ' + px('.og-dict-heading', 'color'),
        credit: d.querySelector('.og-dict-credit').textContent,
        word: d.querySelector('.og-dict-word').textContent + ' ' + px('.og-dict-word', 'fontSize') + '/' + px('.og-dict-word', 'lineHeight'),
        pos: px('.og-dict-pos', 'fontStyle') + ' ' + px('.og-dict-pos', 'color'),
        def: d.querySelector('.og-dict-def').textContent,
        noExample: !d.querySelector('.og-dict-example'),
        label: d.querySelector('.og-dict-similar .og-dict-label').textContent + ' ' + px('.og-dict-similar .og-dict-label', 'color'),
        chipStyle: px('.og-dict-chip', 'height') + ' ' + px('.og-dict-chip', 'fontSize') + ' ' + px('.og-dict-chip', 'borderTopLeftRadius'),
        chipCount: chips.length,
        clampedHeight: similar.clientHeight,
        rows: new Set(chips.filter((c) => c.offsetTop + c.offsetHeight <= similar.clientHeight).map((c) => c.offsetTop)).size,
        caret: !!similar.querySelector('.og-dict-caret'),
        oppositeRemoved: !d.querySelector('.og-dict-opposite'),
        more: d.querySelector('.og-dict-more').textContent,
        pill: px('.og-dict-more', 'width') + ' ' + px('.og-dict-more', 'height') + ' ' + px('.og-dict-more', 'backgroundColor'),
      };
    });
    check('synonym variant', /og-dict-synonym/.test(r.variant), r.variant);
    check('"Similar and opposite words" heading at 14px #5e5e5e', r.heading === 'Similar and opposite words 14px rgb(94, 94, 94)', r.heading);
    check('attribution line at the top', r.credit === 'Definitions from Wiktionary · Synonyms from Datamuse · Learn more', r.credit);
    check('word at 28px/36px', r.word === 'marvelous 28px/36px', r.word);
    check('italic #5e5e5e part of speech', r.pos === 'italic rgb(94, 94, 94)', r.pos);
    check('one short definition, no example', /Exciting wonder or surprise/.test(r.def) && r.noExample, r.def);
    check('label "Similar" without a colon, green', r.label === 'Similar rgb(24, 128, 56)', r.label);
    check('bigger chips: 26px tall, 14px, pill', r.chipStyle === '26px 14px 32px', r.chipStyle);
    check('all 15 synonyms as chips', r.chipCount === 15, r.chipCount);
    check('clamped to two rows (68px) with a caret', r.clampedHeight === 68 && r.rows === 2 && r.caret, r);
    check('a word with no antonyms drops the Opposite row', r.oppositeRemoved);
    check('footer pill reads "More similar and opposite words"', r.more === 'More similar and opposite words', r.more);
    check('same 300x36 grey pill', r.pill === '300px 36px rgb(241, 243, 244)', r.pill);

    const lastShown = () => page.waitForTimeout(350).then(() => page.evaluate(() => {
      const similar = document.querySelector('.og-dict-similar .og-dict-chips');
      const last = similar.querySelector('.og-dict-chip:last-child');
      return last.offsetTop + last.offsetHeight <= similar.clientHeight;
    }));
    await page.click('.og-dict-similar .og-dict-caret');
    check('the caret opens the list', await lastShown());
    await page.click('.og-dict-similar .og-dict-caret');
    check('and closes it again', !(await lastShown()));
    await page.click('.og-dict-more');
    check('"More similar and opposite words" lifts the clamp', await lastShown());
    await page.close();
  }

  console.log('\nan antonym query leads with Opposite');
  {
    const page = await open(browser, '?q=happy+antonym', false);
    const first = await page.evaluate(() => document.querySelector('#og-dictionary .og-dict-row').className);
    check('Opposite row first', /og-dict-opposite/.test(first), first);
    await page.close();
  }

  console.log('\ndark mode');
  {
    const page = await open(browser, '?dark=1', true);
    const r = await page.evaluate(() => {
      const d = document.getElementById('og-dictionary');
      const px = (sel, prop) => getComputedStyle(d.querySelector(sel))[prop];
      return {
        dark: document.documentElement.classList.contains('og-dark'),
        blockBg: getComputedStyle(d).backgroundColor,
        chip: [px('.og-dict-chip', 'borderTopColor'), px('.og-dict-chip', 'color'), px('.og-dict-chip', 'backgroundColor')],
        similar: px('.og-dict-similar .og-dict-label', 'color'),
        opposite: px('.og-dict-opposite .og-dict-label', 'color'),
        secondary: [px('.og-dict-pos', 'color'), px('.og-dict-example', 'color'), px('.og-dict-feedback', 'color')],
        rule: getComputedStyle(d.querySelector('.og-dict-rule'), '::before').borderTopColor,
        pill: px('.og-dict-more', 'backgroundColor'),
        speaker: px('.og-dict-speak span', 'backgroundColor'),
        heading: px('.og-dict-heading', 'color'),
        white: Array.from(d.querySelectorAll('*')).filter((e) => getComputedStyle(e).backgroundColor === 'rgb(255, 255, 255)').length,
      };
    });
    check('dark theme detected', r.dark);
    check('block paints no ground of its own', r.blockBg === 'rgba(0, 0, 0, 0)', r.blockBg);
    check('chips: #3c4043 border, #e8eaed text, no fill', r.chip.join() === 'rgb(60, 64, 67),rgb(232, 234, 237),rgba(0, 0, 0, 0)', r.chip);
    check('labels soften to #81c995 / #f28b82', r.similar === 'rgb(129, 201, 149)' && r.opposite === 'rgb(242, 139, 130)', [r.similar, r.opposite]);
    check('secondary text is #bdc1c6', r.secondary.every((c) => c === 'rgb(189, 193, 198)'), r.secondary);
    check('rule #3c4043, pill #303134, speaker stays blue', r.rule === 'rgb(60, 64, 67)' && r.pill === 'rgb(48, 49, 52)' && r.speaker === 'rgb(66, 133, 244)', [r.rule, r.pill, r.speaker]);
    check('nothing glares white', r.white === 0 && r.heading === 'rgb(232, 234, 237)', [r.white, r.heading]);
    await page.close();
  }

  console.log('\nWiktionary down, Datamuse up');
  {
    const page = await open(browser, '?q=marvelous+synonym&fail=wiktionary', false);
    const r = await page.evaluate(() => {
      const d = document.getElementById('og-dictionary');
      return d && {
        variant: d.className,
        pos: d.querySelector('.og-dict-pos').textContent,
        def: d.querySelector('.og-dict-def').textContent,
        chips: d.querySelectorAll('.og-dict-chip:not(.og-dict-caret)').length,
        credit: d.querySelector('.og-dict-credit span').textContent,
      };
    });
    check('thesaurus block still shows', r && /og-dict-synonym/.test(r.variant), r);
    check('definition falls back to Datamuse', r && r.pos === 'adjective' && /Exciting wonder/.test(r.def), r);
    check('chips present', r && r.chips === 15, r && r.chips);
    check('credit says so', r && r.credit === 'Definitions and synonyms from Datamuse', r && r.credit);
    await page.close();
  }

  console.log('\nnothing usable from either source');
  {
    const page = await open(browser, '?q=zzzq+definition', false);
    const r = await page.evaluate(() => ({
      card: !!document.getElementById('og-dictionary'),
      pending: window.OG.dictionaryPending, active: window.OG.dictionaryActive,
      googleBoxVisible: document.getElementById('google-dict-box').checkVisibility(),
    }));
    check('no card, flags cleared, Google\'s box left alone', !r.card && !r.pending && !r.active && r.googleBoxVisible, r);
    await page.close();
  }

  console.log('\nOxford Languages with credentials');
  {
    const page = await open(browser, '?q=define+happy&oxford=1', false);
    await page.waitForTimeout(250); // thesaurus chips land after the card
    const r = await page.evaluate(() => {
      const d = document.getElementById('og-dictionary');
      return {
        credit: d.querySelector('.og-dict-credit span').textContent,
        pron: d.querySelector('.og-dict-pron').textContent,
        senses: Array.from(d.querySelectorAll('.og-dict-def')).map((e) => e.textContent),
        example: d.querySelector('.og-dict-example').textContent,
        similar: Array.from(d.querySelectorAll('.og-dict-similar .og-dict-chip:not(.og-dict-caret)')).map((c) => c.textContent),
        opposite: Array.from(d.querySelectorAll('.og-dict-opposite .og-dict-chip:not(.og-dict-caret)')).map((c) => c.textContent),
      };
    });
    check('credited to Oxford Languages, like Google was', r.credit === 'Definitions from Oxford Languages', r.credit);
    check("Oxford's respelling shown", r.pron === '/ˈhapē/', r.pron);
    check('Oxford senses in order', r.senses[0] === 'feeling or showing pleasure or contentment' && r.senses[1] === 'fortunate and convenient', r.senses);
    check('Oxford example quoted', r.example === '"Melissa came in looking happy and excited"', r.example);
    check('thesaurus synonyms across senses, deduplicated', r.similar.length === 15 && r.similar[0] === 'cheerful' && r.similar[12] === 'fortunate', r.similar);
    check('thesaurus antonyms', r.opposite.join(',') === 'sad,unhappy,unfortunate', r.opposite);
    await page.close();
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();

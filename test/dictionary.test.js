/* The definition / synonym panel: which queries trigger it, what it renders,
 * and that it does not fire on ordinary searches.
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

console.log('\nqueries that should open the panel');
for (const [q, word, mode] of [
  ['gazelle definition', 'gazelle', 'define'],
  ['define gazelle', 'gazelle', 'define'],
  ['definition of gazelle', 'gazelle', 'define'],
  ['what does gazelle mean', 'gazelle', 'define'],
  ['gazelle meaning', 'gazelle', 'define'],
  ['Define Ephemeral', 'ephemeral', 'define'],
  ['synonyms for happy', 'happy', 'synonym'],
  ['happy synonyms', 'happy', 'synonym'],
  ['another word for happy', 'happy', 'synonym'],
  ['antonyms of happy', 'happy', 'synonym'],
  ['the meaning of serendipity', 'serendipity', 'define'],
]) {
  const t = OG.dictionaryTarget(q);
  check(`"${q}" -> ${word} (${mode})`, t && t.word === word && t.mode === mode, t);
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
  check(`"${q}" -> no panel`, OG.dictionaryTarget(q) === null, OG.dictionaryTarget(q));
}

console.log('\nrendering');
{
  const api = [{
    word: 'gazelle',
    phonetic: '/ɡəˈzɛl/',
    phonetics: [{ text: '/ɡəˈzɛl/' }],
    meanings: [{
      partOfSpeech: 'noun',
      definitions: [
        { definition: 'Any of numerous antelopes of the genus Gazella, noted for their grace and speed.', example: 'a herd of gazelles', synonyms: ['antelope'] },
        { definition: 'A light brown colour.', example: '', synonyms: [] },
      ],
      synonyms: ['antelope', 'springbok'],
      antonyms: [],
    }],
    sourceUrls: ['https://en.wiktionary.org/wiki/gazelle'],
  }];

  // shape() is internal; exercise it through the same path the driver uses.
  const shaped = (() => {
    let out = null;
    const orig = OG.el;
    // render() is exported; feed it the shape the driver would build
    out = {
      word: 'gazelle',
      phonetic: '/ɡəˈzɛl/',
      blocks: [{
        pos: 'noun',
        senses: [
          { text: api[0].meanings[0].definitions[0].definition, example: 'a herd of gazelles', synonyms: ['antelope'] },
          { text: 'A light brown colour.', example: '', synonyms: [] },
        ],
        synonyms: ['antelope', 'springbok'],
        antonyms: [],
      }],
      sourceUrl: 'https://en.wiktionary.org/wiki/gazelle',
    };
    OG.el = orig;
    return out;
  })();

  const panel = OG.renderDictionary(shaped, 'define');
  const text = panel.textContent;
  check('word shown', panel.querySelector('.og-dict-word').textContent === 'gazelle');
  check('pronunciation shown', panel.querySelector('.og-dict-phonetic').textContent === '/ɡəˈzɛl/');
  check('part of speech shown', panel.querySelector('.og-dict-pos').textContent === 'noun');
  check('senses are a numbered list', panel.querySelectorAll('.og-dict-senses li').length === 2);
  check('example is quoted', /"a herd of gazelles"/.test(text), text.slice(0, 200));
  check('similar words shown', /similar:/.test(text));
  check('source credited', /Wiktionary/.test(text));

  const thes = OG.renderDictionary(shaped, 'synonym');
  const synRow = thes.querySelector('.og-dict-syn');
  check('thesaurus mode leads with synonyms', synRow && /antelope/.test(synRow.textContent), synRow && synRow.textContent);
}

console.log('\nnothing is rendered from untrusted markup');
{
  const nasty = {
    word: '<img src=x onerror=alert(1)>',
    phonetic: '<script>bad()</script>',
    blocks: [{ pos: 'noun', senses: [{ text: '<b>not bold</b>', example: '', synonyms: [] }], synonyms: [], antonyms: [] }],
    sourceUrl: 'https://en.wiktionary.org/wiki/x',
  };
  const panel = OG.renderDictionary(nasty, 'define');
  check('no elements injected from API strings', panel.querySelectorAll('img, script, b').length === 0,
    panel.innerHTML.slice(0, 160));
  check('API text is shown literally', panel.textContent.includes('<b>not bold</b>'));
}

/* The card keeps its border once mounted in #rso, where a blanket reset strips
 * borders from every other child. */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('file://' + path.join(__dirname, '..', 'demo', 'serp-dictionary.html'));
  await page.waitForFunction(() => window.__ready === true);
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => {
    const d = document.getElementById('og-dictionary');
    if (!d) return null;
    const cs = getComputedStyle(d);
    return {
      border: cs.borderTopWidth,
      radius: cs.borderTopLeftRadius,
      width: Math.round(d.getBoundingClientRect().width),
      firstInRso: document.getElementById('rso').firstElementChild.id,
      snippetSuppressed: !document.getElementById('og-featured'),
      wordSize: getComputedStyle(d.querySelector('.og-dict-word')).fontSize,
    };
  });
  await browser.close();

  console.log('\nmounted on a page');
  check('panel keeps its card border in #rso', r && r.border === '1px' && r.radius === '8px', r);
  check('panel is 652px like the column', r && r.width === 652, r && r.width);
  check('panel sits above everything else', r && r.firstInRso === 'og-dictionary', r && r.firstInRso);
  check('featured snippet suppressed for a definition query', r && r.snippetSuppressed, r);
  check('word is set at 30px', r && r.wordSize === '30px', r && r.wordSize);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();

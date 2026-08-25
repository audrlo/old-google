/* Runs the real content-script extractor under jsdom.
 *
 * The modules are plain IIFEs that hang off window, so we load them into a jsdom
 * window with vm — exactly how Chrome loads them, minus the chrome.* APIs.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const fixtures = require('./fixtures');

const SRC = path.join(__dirname, '..', 'src', 'content');

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://www.google.com/search?q=test',
  runScripts: 'outside-only',
});
const win = dom.window;
win.chrome = {
  storage: {
    sync: { get: async () => ({}), set: async () => {} },
    local: { get: async () => ({}), set: async () => {} },
    onChanged: { addListener() {} },
  },
  runtime: { sendMessage() {} },
};

for (const file of ['00-state.js', '20-extract.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, file), 'utf8'), dom.getInternalVMContext(), {
    filename: file,
  });
}
const OG = win.OG;

/* ------------------------------- runner ------------------------------- */

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('  ok   ' + name);
  } else {
    fail++;
    console.log('  FAIL ' + name + (detail ? '\n         ' + detail : ''));
  }
}
function group(name) {
  console.log('\n' + name);
}

/* -------------------------------- tests ------------------------------- */

group('definitional query -> paragraph from the lead');
{
  const r = OG.extractAnswer(fixtures.wikipedia, 'what is a black hole', 'https://en.wikipedia.org/wiki/Black_hole');
  check('returns an answer', !!r);
  check('kind is paragraph', r && r.kind === 'paragraph', r && r.kind);
  check('quotes the lead sentence', r && r.text.startsWith('A black hole is a region of spacetime'), r && r.text.slice(0, 60));
  check('strips [1] citation markers', r && !r.text.includes('[1]'), r && r.text);
  check('title from og:title', r && r.title === 'Black hole - Wikipedia', r && r.title);
  check('bold range covers the answer sentence', r && r.bold && r.bold.end > r.bold.start, JSON.stringify(r && r.bold));
  check('length is snippet-sized (<=360)', r && r.text.length <= 360, r && String(r.text.length));
  check('drops nav boilerplate', r && !/Main page|Recent changes/.test(r.text));
}

group('how-to query -> ordered list');
{
  const r = OG.extractAnswer(fixtures.wikipedia, 'how do black holes form', 'https://en.wikipedia.org/wiki/Black_hole');
  check('returns an answer', !!r);
  check('kind is list', r && r.kind === 'list', r && r.kind);
  check('ordered', r && r.ordered === true);
  check('has 5 steps', r && r.items.length === 5, r && String(r.items.length));
  check('first step is right', r && /exhausts the hydrogen fuel/.test(r.items[0]), r && r.items[0]);
}

group('how-to on a recipe page, with a nav list and a sidebar present');
{
  const r = OG.extractAnswer(fixtures.recipe, 'how to make cold brew coffee', 'https://example.com/cold-brew');
  check('returns an answer', !!r);
  check('kind is list', r && r.kind === 'list', r && r.kind);
  check('picked the steps, not the nav', r && r.items.length === 5, r && JSON.stringify(r.items));
  check('did not pick the sidebar', r && !r.items.some((i) => /iced latte/.test(i)));
}

group('comparison query -> table');
{
  const r = OG.extractAnswer(fixtures.wikipedia, 'black hole classes mass radius comparison', 'https://en.wikipedia.org/wiki/Black_hole');
  check('returns an answer', !!r);
  check('kind is table', r && r.kind === 'table', r && r.kind);
  check('header row present', r && r.grid[0][0] === 'Class', r && JSON.stringify(r.grid[0]));
  check('3 columns', r && r.grid[0].length === 3, r && String(r.grid[0].length));
}

group('bails out rather than inventing an answer');
{
  const r = OG.extractAnswer(fixtures.thin, 'what is the airspeed velocity of an unladen swallow', 'https://example.com/');
  check('returns null on a thin page', r === null, JSON.stringify(r));

  const h = OG.extractAnswer(fixtures.hostile, 'why is this blocked', 'https://example.com/');
  check('returns null on an interstitial', h === null, JSON.stringify(h));
}

group('parsing is inert');
{
  const before = win.pwned;
  OG.extractAnswer(fixtures.hostile, 'anything', 'https://example.com/');
  check('no script from the fetched page ran', !win.pwned && !win.pwned2);
  check('host document title untouched', win.document.title !== 'PWNED', win.document.title);
  check('no state leaked', before === win.pwned);
}

group('malformed input does not throw');
{
  let threw = false;
  try {
    OG.extractAnswer('<html><body><p>', 'x', 'https://example.com/');
    OG.extractAnswer('', '', 'not a url');
    OG.extractAnswer('<<<>>>', 'a b c', 'https://example.com/');
  } catch (err) {
    threw = true;
    console.log('    threw: ' + err);
  }
  check('survives garbage html', !threw);
}

group('inflected forms match (query "gazelles eat" vs page "gazelle eats")');
{
  const r = OG.extractAnswer(fixtures.contentFarm, 'what do gazelles eat', 'https://example.com/');
  check('finds an answer at all', !!r);
  check('it is a paragraph', r && r.kind === 'paragraph', r && r.kind);
}

group('the intro preamble never wins');
{
  const r = OG.extractAnswer(fixtures.contentFarm, 'what do gazelles eat', 'https://example.com/');
  check('does not quote "In this article we\'ll explore..."', r && !/In this article/.test(r.text), r && r.text.slice(0, 70));
  check('does not quote "Before we get to..."', r && !/Before we get to/.test(r.text), r && r.text.slice(0, 70));
  check('picks the passage that answers it', r && /eats grasses, shoots, herbs/.test(r.text), r && r.text.slice(0, 80));
}

group("Google's own description is used as the anchor");
{
  const anchor = 'The gazelle eats grasses, shoots, herbs and the leaves of low shrubs, and it browses ...';
  const r = OG.extractAnswer(fixtures.contentFarm, 'gazelle', 'https://example.com/', anchor);
  check('anchored pick is the full untruncated passage',
    r && /eats grasses, shoots, herbs/.test(r.text) && !/\.\.\./.test(r.text), r && r.text);
  check('and it is longer than the truncated description Google showed',
    r && r.text.length > anchor.length - 4, r && { got: r.text.length, anchor: anchor.length });

  // The anchor must be decisive, not merely agree with the scorer. Point it at a
  // passage the keyword scoring would NOT have chosen and check it wins anyway.
  const elsewhere = 'Cheetahs, lions and wild dogs all hunt gazelle across the open savannah ...';
  const steered = OG.extractAnswer(fixtures.contentFarm, 'gazelle', 'https://example.com/', elsewhere);
  const unsteered = OG.extractAnswer(fixtures.contentFarm, 'gazelle', 'https://example.com/');
  check('scoring alone picks the diet passage', unsteered && /eats grasses/.test(unsteered.text), unsteered && unsteered.text.slice(0, 50));
  check("Google's pick overrides it", steered && /Cheetahs, lions and wild dogs/.test(steered.text), steered && steered.text.slice(0, 50));
}

group('a wrong anchor cannot force a bad pick on an unrelated page');
{
  const r = OG.extractAnswer(fixtures.wikipedia, 'what is a black hole', 'https://en.wikipedia.org/', 'completely unrelated text about kitchen appliances and toasters');
  check('falls back to scoring when the anchor is absent', r && /A black hole is a region of spacetime/.test(r.text), r && r.text.slice(0, 60));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

/* Which queries open the emoji box, and which emoji they pick, against the
 * real table in data/emoji.json. jsdom, no browser. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const SRC = path.join(__dirname, '..', 'src', 'content');
const dom = new JSDOM('<!doctype html><html><body><div id="rso"></div></body></html>', {
  url: 'https://www.google.com/search?q=fire+emoji',
  runScripts: 'outside-only',
});
const win = dom.window;
win.chrome = {
  storage: { sync: { get: async () => ({}), set: async () => {} }, local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } },
  runtime: { lastError: null, sendMessage() {} },
};
for (const f of ['00-state.js', '27-emoji.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), dom.getInternalVMContext(), { filename: f });
}
const OG = win.OG;
const TABLE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'emoji.json'), 'utf8'));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '\n         ' + JSON.stringify(detail) : '')); }
}
const first = (q) => { const t = OG.emojiTarget(q); return t && (OG.emojiMatches(t, TABLE)[0] || {}).c; };

console.log('\nwhich queries open the box');
for (const [q, want] of [
  ['fire emoji', '🔥'], ['fire emoji copy', '🔥'], ['Fire Emoji Copy Paste', '🔥'], ['fire emoji copy and paste', '🔥'],
  ['copy paste fire emoji', '🔥'], ['emoji for fire', '🔥'], ['the fire emoji', '🔥'],
  ['shrug emoji', '🤷'], ['skull emoji copy', '💀'], ['100 emoji', '💯'], ['thumbs up emoji', '👍'],
  ['pizza emoji', '🍕'], ['heart emoji', '❤️'], ['rocket emoji copy', '🚀'], ['thinking emoji', '🤔'],
  ['crying laughing emoji', '😂'], ['🔥 emoji', '🔥'], ['🤷‍♀️', '🤷‍♀️'], ['❤️ copy', '❤️'],
  ['american flag emoji', '🇺🇸'], ['us flag emoji', '🇺🇸'], ['usa flag emoji', '🇺🇸'], ['uk flag emoji', '🇬🇧'],
  ['japan flag emoji', '🇯🇵'], ['japanese flag emoji', '🇯🇵'], ['mexican flag emoji', '🇲🇽'], ['🇺🇸 emoji', '🇺🇸'],
  ['👍🏿', '👍🏿'], ['👍🏿 emoji copy', '👍🏿'], ['1️⃣ emoji', '1️⃣'], ['eggplant emoji', '🍆'], ['melting face emoji', '🫠'],
]) check(q + ' -> ' + want, first(q) === want, first(q));

console.log('\nwhich queries do not');
for (const q of ['emoji', 'emoji meanings', 'how to type emoji on mac', 'emoji movie', 'what is an emoji', 'gazelle definition', ''])
  check(JSON.stringify(q) + ' is not an emoji query', OG.emojiTarget(q) === null, OG.emojiTarget(q));

console.log('\nranking');
{
  const hearts = OG.emojiMatches(OG.emojiTarget('heart emoji'), TABLE);
  check('heart gives the red heart first and more hearts after', hearts[0].c === '❤️' && hearts.length > 3 && hearts.every((e) => /heart/.test(e.n) || e.k.includes('heart')), hearts.map((e) => e.c));
  check('at most eight matches', hearts.length <= 8, hearts.length);
  check('no matches for nonsense', OG.emojiMatches(OG.emojiTarget('xqzzy emoji'), TABLE).length === 0);
  const toned = OG.emojiMatches(OG.emojiTarget('👍🏿'), TABLE);
  check('a toned emoji comes back as typed, then its base', toned.length === 2 && toned[0].c === '👍🏿' && toned[1].c === '👍', toned.map((e) => e.c));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

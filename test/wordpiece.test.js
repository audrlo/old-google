/* The WordPiece tokenizer must match what bert-base-uncased was trained on.
 * A mistake here does not throw — it silently feeds the model wrong token ids
 * and produces meaningless scores — so it is pinned against known ids.
 */
const fs = require('fs');
const path = require('path');
const wp = require(path.join(__dirname, '..', 'src', 'offscreen', 'wordpiece.js'));

const tok = wp.create(fs.readFileSync(path.join(__dirname, '..', 'vendor', 'model', 'vocab.txt'), 'utf8'));

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('  ok   ' + name);
  } else {
    fail++;
    console.log('  FAIL ' + name + (detail !== undefined ? '\n         ' + JSON.stringify(detail) : ''));
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('\nvocabulary');
check('30,522 tokens (bert-base-uncased)', tok.vocabSize === 30522, tok.vocabSize);
check('[CLS]=101 [SEP]=102 [PAD]=0 [UNK]=100',
  tok.CLS === 101 && tok.SEP === 102 && tok.PAD === 0 && tok.UNK === 100,
  { CLS: tok.CLS, SEP: tok.SEP, PAD: tok.PAD, UNK: tok.UNK });

console.log('\nknown token ids');
check('"hello world" -> [7592, 2088]', eq(tok.encodeText('hello world'), [7592, 2088]), tok.encodeText('hello world'));
check('casing is folded', eq(tok.encodeText('HELLO WORLD'), tok.encodeText('hello world')));
check('"the" -> [1996]', eq(tok.encodeText('the'), [1996]), tok.encodeText('the'));

console.log('\nsubword segmentation');
{
  const ids = tok.encodeText('gazelles');
  check('"gazelles" splits into two pieces', ids.length === 2, ids);
  // "gazelle" is itself two pieces (gaze + ##lle), so the singular is not a
  // prefix of the plural — but both start from the same first subword, which is
  // how the model sees them as related.
  check('singular and plural share their first subword',
    ids[0] === tok.encodeText('gazelle')[0],
    { gazelles: ids, gazelle: tok.encodeText('gazelle') });
  check('a nonsense word still segments rather than becoming [UNK]',
    !tok.encodeText('flurbleglorp').includes(tok.UNK), tok.encodeText('flurbleglorp'));
}

console.log('\nbasic tokenizer');
check('punctuation is split off', eq(tok.basicTokenize("Don't stop!"), ['don', "'", 't', 'stop', '!']), tok.basicTokenize("Don't stop!"));
check('accents are stripped', eq(tok.basicTokenize('Café'), ['cafe']), tok.basicTokenize('Café'));
check('whitespace runs collapse', eq(tok.basicTokenize('a \t\n b'), ['a', 'b']), tok.basicTokenize('a \t\n b'));
check('empty input yields nothing', eq(tok.basicTokenize('   '), []), tok.basicTokenize('   '));

console.log('\npair encoding for a cross-encoder');
{
  const p = tok.encodePair('what do gazelles eat', 'Their diet consists of grasses.');
  check('starts with [CLS]', p.inputIds[0] === tok.CLS);
  check('ends with [SEP]', p.inputIds[p.inputIds.length - 1] === tok.SEP);
  check('exactly two [SEP] separators', p.inputIds.filter((id) => id === tok.SEP).length === 2);
  check('type ids are 0 then 1, never interleaved',
    /^0+1+$/.test(p.typeIds.join('')), p.typeIds.join(''));
  check('the 0/1 boundary is just after the first [SEP]',
    p.typeIds.indexOf(1) === p.inputIds.indexOf(tok.SEP) + 1,
    { firstOne: p.typeIds.indexOf(1), firstSep: p.inputIds.indexOf(tok.SEP) });
  check('attention mask is all ones before padding', p.mask.every((m) => m === 1));
  check('all three arrays are the same length',
    p.inputIds.length === p.typeIds.length && p.typeIds.length === p.mask.length);
}

console.log('\ntruncation');
{
  const long = 'word '.repeat(5000);
  const p = tok.encodePair('short query', long, 320);
  check('respects the length limit', p.inputIds.length <= 320, p.inputIds.length);
  check('still well-formed after truncating', p.inputIds[p.inputIds.length - 1] === tok.SEP);
  check('the query survives truncation', p.typeIds.indexOf(1) > 3, p.typeIds.indexOf(1));

  const longQuery = tok.encodePair('q '.repeat(500), 'a passage', 320);
  check('an absurd query is capped, leaving room for the passage',
    longQuery.inputIds.length <= 320 && longQuery.typeIds.includes(1),
    { len: longQuery.inputIds.length, hasPassage: longQuery.typeIds.includes(1) });
}

console.log('\nbatch padding');
{
  const batch = tok.padBatch([
    tok.encodePair('a', 'short'),
    tok.encodePair('a', 'a considerably longer passage than the other one here'),
  ]);
  const [n, width] = batch.dims;
  check('dims are [rows, width]', n === 2 && width > 5, batch.dims);
  check('padding uses [PAD]', Number(batch.inputIds[width - 1]) === tok.PAD, Number(batch.inputIds[width - 1]));
  check('padded positions are masked out', Number(batch.mask[width - 1]) === 0, Number(batch.mask[width - 1]));
  check('tensors are int64 for ONNX', batch.inputIds instanceof BigInt64Array);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

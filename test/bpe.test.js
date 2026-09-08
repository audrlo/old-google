/* The byte-level BPE tokenizer must match what deepset/tinyroberta-squad2 was
 * trained with. A mistake here does not throw — it silently feeds the model
 * wrong token ids and produces meaningless scores — so every case is pinned
 * against ids produced by transformers' RobertaTokenizerFast.
 *
 * test/fixtures/bpe-cases.json is generated from the model's own tokenizer
 * files with tok(query, passage, truncation='only_second', max_length=N).
 */
const fs = require('fs');
const path = require('path');
const bpe = require(path.join(__dirname, '..', 'src', 'offscreen', 'bpe.js'));

// The tokenizer files live beside the model; OG_ROBERTA_DIR points elsewhere.
const modelDir = process.env.OG_ROBERTA_DIR || path.join(__dirname, '..', 'vendor', 'model');
const tok = bpe.create(
  fs.readFileSync(path.join(modelDir, 'vocab.json'), 'utf8'),
  fs.readFileSync(path.join(modelDir, 'merges.txt'), 'utf8')
);
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'bpe-cases.json'), 'utf8'));

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
check('50,265 tokens (roberta-base)', tok.vocabSize === fixture.meta.vocabSize, tok.vocabSize);
check('<s>=0 <pad>=1 </s>=2 <unk>=3, read from vocab.json',
  tok.CLS === fixture.meta.cls && tok.SEP === fixture.meta.sep && tok.PAD === fixture.meta.pad && tok.UNK === fixture.meta.unk,
  { CLS: tok.CLS, SEP: tok.SEP, PAD: tok.PAD, UNK: tok.UNK });

console.log('\nknown token ids');
check('"Hello world" -> [31414, 232]', eq(tok.encodeText('Hello world'), [31414, 232]), tok.encodeText('Hello world'));
check('casing is NOT folded', !eq(tok.encodeText('hello world'), tok.encodeText('Hello world')));
check('"the" -> [627]', eq(tok.encodeText('the'), [627]), tok.encodeText('the'));
check('a leading space makes a different token: " world" -> [232], "world" -> [8331]',
  eq(tok.encodeText(' world'), [232]) && eq(tok.encodeText('world'), [8331]),
  { spaced: tok.encodeText(' world'), bare: tok.encodeText('world') });
check('no prefix space is added to the first word', tok.encodeText('world')[0] === 8331, tok.encodeText('world'));

console.log('\npre-tokenizer');
check('contractions and punctuation are split off',
  eq(tok.preTokenize("Don't stop!"), ['Don', "'t", ' stop', '!']), tok.preTokenize("Don't stop!"));
check('one space stays attached to the following word',
  eq(tok.preTokenize('a b'), ['a', ' b']), tok.preTokenize('a b'));
check('in a run of spaces only the last one attaches',
  eq(tok.preTokenize('a   b'), ['a', '  ', ' b']), tok.preTokenize('a   b'));
check('trailing whitespace is its own chunk',
  eq(tok.preTokenize('a  '), ['a', '  ']), tok.preTokenize('a  '));
check('letters and digits split apart',
  eq(tok.preTokenize('abc123'), ['abc', '123']), tok.preTokenize('abc123'));
check('empty input yields nothing', eq(tok.preTokenize(''), []), tok.preTokenize(''));

console.log('\nsingle-sequence ids match transformers');
for (const c of fixture.cases) {
  const q = tok.encodeText(c.query);
  const p = tok.encodeText(c.passage);
  check(c.name + ': query', eq(q, c.queryIds), { got: q, want: c.queryIds });
  check(c.name + ': passage', eq(p, c.passageIds), { got: p, want: c.passageIds });
}

console.log('\npair encoding matches transformers (truncation=only_second)');
for (const c of fixture.cases) {
  const e = tok.encodePair(c.query, c.passage, c.maxLength);
  check(c.name + ': input_ids', eq(e.inputIds, c.inputIds), { got: e.inputIds, want: c.inputIds });
  check(c.name + ': attention mask', eq(e.mask, c.attentionMask));
  check(c.name + ': length is min(full, maxLength)',
    e.inputIds.length === Math.min(c.untruncatedLength, c.maxLength),
    { len: e.inputIds.length, full: c.untruncatedLength, max: c.maxLength });
  check(c.name + ': all arrays are the same length',
    e.inputIds.length === e.typeIds.length && e.typeIds.length === e.mask.length);
}

console.log('\ntype ids mark the passage for the caller');
for (const c of fixture.cases) {
  const e = tok.encodePair(c.query, c.passage, c.maxLength);
  const first = e.typeIds.indexOf(1);
  if (!c.passageIds.length) {
    // transformers drops an empty text_pair entirely: <s> query </s>, so
    // there is no passage to mark and the caller sees nothing to score.
    check(c.name + ': no 1s and contextStart -1 for a missing passage',
      first === -1 && e.contextStart === -1 && e.inputIds[e.inputIds.length - 1] === tok.SEP,
      { first, contextStart: e.contextStart, ids: e.inputIds });
    continue;
  }
  const expectedStart = Math.min(c.queryIds.length, 64) + 3; // <s> query </s></s>
  check(c.name + ': 0s then 1s, never interleaved', /^0+1+$/.test(e.typeIds.join('')), e.typeIds.join(''));
  check(c.name + ': first 1 is right after </s></s>',
    first === expectedStart && e.inputIds[first - 1] === tok.SEP && e.inputIds[first - 2] === tok.SEP && e.inputIds[0] === tok.CLS,
    { first, expectedStart, ids: e.inputIds.slice(0, first + 1) });
  check(c.name + ': contextStart agrees with typeIds', e.contextStart === first, { contextStart: e.contextStart, first });
  // The 1s cover exactly the passage tokens plus the closing </s>, so the
  // caller's span search (ctxStart..len-1) sees only passage tokens.
  const passageLen = e.inputIds.length - first - 1;
  check(c.name + ': passage tokens are a prefix of the untruncated passage',
    eq(e.inputIds.slice(first, first + passageLen), c.passageIds.slice(0, passageLen)));
}

console.log('\nedge cases');
{
  const empty = tok.encodePair('what do gazelles eat', '', 320);
  check('an empty passage yields <s> q </s> with nothing marked as passage (as transformers does)',
    eq(empty.inputIds, [tok.CLS].concat(tok.encodeText('what do gazelles eat'), [tok.SEP]))
      && empty.typeIds.indexOf(1) === -1 && empty.contextStart === -1,
    empty);
  const cut = tok.encodePair('one two three four five six seven', 'x y z', 11);
  check('a passage truncated to nothing keeps </s></s> </s> (transformers throws here; we leave it unscorable)',
    eq(cut.inputIds.slice(-3), [tok.SEP, tok.SEP, tok.SEP]) && cut.typeIds.indexOf(1) === cut.inputIds.length - 1,
    cut);
  const longQuery = tok.encodePair('q '.repeat(500), 'a passage', 320);
  check('an absurd query is capped at 64 tokens, leaving room for the passage',
    longQuery.typeIds.indexOf(1) === 64 + 3 && longQuery.inputIds.length <= 320 && longQuery.typeIds.includes(1),
    { start: longQuery.typeIds.indexOf(1), len: longQuery.inputIds.length });
  check('the query is never truncated to fit',
    tok.encodePair('one two three four five six seven', 'x', 8).typeIds.indexOf(1) === 7 + 3);
  check('encoding twice gives the same result (cache)',
    eq(tok.encodeText('Gazelles gazelles gazelles'), tok.encodeText('Gazelles gazelles gazelles')));
  check('every byte value is encodable without <unk>',
    !tok.encodeText(Array.from({ length: 256 }, (_, i) => String.fromCharCode(i)).join('')).includes(tok.UNK));
  const cjk = tok.encodeText('日本');
  check('multi-byte characters produce ids, not <unk>', cjk.length > 0 && !cjk.includes(tok.UNK), cjk);
}

console.log('\nbatch padding');
{
  const short = tok.encodePair('a', 'short');
  const long = tok.encodePair('a', 'a considerably longer passage than the other one here');
  const batch = tok.padBatch([short, long]);
  const [n, width] = batch.dims;
  check('dims are [rows, width]', n === 2 && width === long.inputIds.length, batch.dims);
  check('padding uses <pad>', Number(batch.inputIds[width - 1]) === tok.PAD, Number(batch.inputIds[width - 1]));
  check('padded positions are masked out', Number(batch.mask[width - 1]) === 0, Number(batch.mask[width - 1]));
  check('real positions are unmasked',
    Array.from(batch.mask.slice(0, short.inputIds.length)).every((m) => m === 1n)
      && Array.from(batch.mask.slice(width, 2 * width)).every((m) => m === 1n));
  check('mask flips exactly at the end of the short row',
    Number(batch.mask[short.inputIds.length - 1]) === 1 && Number(batch.mask[short.inputIds.length]) === 0);
  check('row ids are copied verbatim',
    eq(Array.from(batch.inputIds.slice(width, 2 * width), Number), long.inputIds)
      && eq(Array.from(batch.inputIds.slice(0, short.inputIds.length), Number), short.inputIds));
  // RoBERTa has no segment embeddings: the model feed is all zeros even though
  // the encodings carry 1s for the caller's span logic.
  check('token_type_ids for the model are all zero', batch.typeIds.every((t) => t === 0n));
  check('encodings still carry passage-marking type ids', short.typeIds.includes(1) && long.typeIds.includes(1));
  check('tensors are int64 for ONNX', batch.inputIds instanceof BigInt64Array && batch.typeIds instanceof BigInt64Array && batch.mask instanceof BigInt64Array);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

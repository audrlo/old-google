/* Old Google (2020) — RoBERTa byte-level BPE tokenizer.
 *
 * The answer-presence model is deepset/tinyroberta-squad2, a RoBERTa, so its
 * input has to be tokenized the way RoBERTa (and GPT-2 before it) was trained:
 * split text with the GPT-2 pre-tokenizer regex, turn each chunk's UTF-8 bytes
 * into printable stand-in characters, then merge adjacent pairs in the order
 * merges.txt lists them. No lowercasing, no accent stripping, and a leading
 * space is part of the word (" world" and "world" are different tokens).
 * Getting this wrong does not throw — it silently produces garbage scores — so
 * it is checked against transformers' own output in the tests.
 *
 * Works in the extension (browser) and under Node for the tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OGBytePairEncoder = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_QUERY_TOKENS = 64;
  const CACHE_LIMIT = 50000; // distinct words remembered before the cache is dropped

  /**
   * GPT-2's pre-tokenizer. Contractions are split off, then runs of letters,
   * numbers, or other characters, each allowed one leading space. The
   * `\s+(?!\S)` branch keeps the last space of a whitespace run attached to
   * the word that follows it. The regex is case-sensitive, as in the original.
   */
  const PRETOKENIZE = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;

  /**
   * GPT-2's bytes-to-unicode table: every byte value gets a printable
   * character so that the vocabulary can be stored as plain strings. The
   * printable ASCII and Latin-1 ranges map to themselves; the rest (controls,
   * space, DEL, soft hyphen...) are shifted up past U+0100. Space becomes "Ġ",
   * which is why vocab.json is full of it.
   */
  function bytesToUnicode() {
    const bytes = [];
    for (let b = 33; b <= 126; b++) bytes.push(b); // '!'..'~'
    for (let b = 161; b <= 172; b++) bytes.push(b); // '¡'..'¬'
    for (let b = 174; b <= 255; b++) bytes.push(b); // '®'..'ÿ'
    const chars = bytes.map((b) => String.fromCodePoint(b));
    let next = 256;
    for (let b = 0; b < 256; b++) {
      if (bytes.includes(b)) continue;
      bytes.push(b);
      chars.push(String.fromCodePoint(next++));
    }
    const table = new Array(256);
    bytes.forEach((b, i) => { table[b] = chars[i]; });
    return table;
  }

  const BYTE_CHAR = bytesToUnicode();
  const utf8 = new TextEncoder();

  /** Split text into the chunks BPE will merge within. */
  function preTokenize(text) {
    return String(text).match(PRETOKENIZE) || [];
  }

  function create(vocabJsonText, mergesText) {
    const vocab = new Map(Object.entries(JSON.parse(vocabJsonText)));

    // merges.txt: one "left right" pair per line, best merge first. A pair's
    // line number is its rank; lower wins when several pairs are present.
    const ranks = new Map();
    const lines = String(mergesText).split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/\r$/, '');
      if (!line || (i === 0 && line.startsWith('#'))) continue;
      ranks.set(line, ranks.size);
    }

    const CLS = vocab.get('<s>');
    const SEP = vocab.get('</s>');
    const PAD = vocab.get('<pad>');
    const UNK = vocab.get('<unk>');
    if (CLS == null || SEP == null || PAD == null || UNK == null) {
      throw new Error('vocab is missing RoBERTa special tokens');
    }

    const cache = new Map();

    /**
     * Merge one pre-tokenized chunk (already in byte-character form). Each
     * round finds the adjacent pair with the best rank and merges every
     * occurrence of it, until no pair is in the merge table. Whole words
     * repeat constantly across passages, so results are cached per word.
     */
    function bpe(word) {
      const hit = cache.get(word);
      if (hit) return hit;

      let symbols = word.split(''); // every byte-character is a single UTF-16 unit
      while (symbols.length > 1) {
        let best = -1;
        let bestRank = Infinity;
        for (let i = 0; i < symbols.length - 1; i++) {
          const rank = ranks.get(symbols[i] + ' ' + symbols[i + 1]);
          if (rank !== undefined && rank < bestRank) {
            bestRank = rank;
            best = i;
          }
        }
        if (best === -1) break;
        const left = symbols[best];
        const right = symbols[best + 1];
        const merged = [];
        for (let i = 0; i < symbols.length; i++) {
          if (i < symbols.length - 1 && symbols[i] === left && symbols[i + 1] === right) {
            merged.push(left + right);
            i++;
          } else {
            merged.push(symbols[i]);
          }
        }
        symbols = merged;
      }
      // Every single byte is in the vocabulary, so <unk> is only a safety net.
      const ids = symbols.map((s) => (vocab.has(s) ? vocab.get(s) : UNK));

      if (cache.size >= CACHE_LIMIT) cache.clear();
      cache.set(word, ids);
      return ids;
    }

    /**
     * Encode text as-is: no prefix space is added, matching
     * RobertaTokenizerFast's default (add_prefix_space=false), which is what
     * the model was fine-tuned with for both the question and the context.
     */
    function encodeText(text) {
      const ids = [];
      for (const chunk of preTokenize(text)) {
        let word = '';
        for (const b of utf8.encode(chunk)) word += BYTE_CHAR[b];
        for (const id of bpe(word)) ids.push(id);
      }
      return ids;
    }

    /**
     * Encode a (query, passage) pair the way RoBERTa expects:
     * <s> query </s></s> passage </s>.
     * The passage is truncated first, never the query (transformers'
     * truncation='only_second'), and the query is capped so a runaway one
     * cannot crowd the passage out.
     *
     * On typeIds: RoBERTa has no segment embeddings and is fed all-zero
     * token_type_ids, but the caller finds the first passage token with
     * typeIds.indexOf(1). So the encoding returned here marks the passage
     * (and its closing </s>) with 1s for that span logic, and padBatch() —
     * which builds the model feed — emits zeros regardless. `contextStart`
     * is the same boundary as an explicit index.
     *
     * An empty passage is encoded as a lone sequence, <s> query </s>, with no
     * 1s and contextStart -1. That is what transformers does (an empty
     * text_pair is treated as absent), and it leaves the caller with nothing
     * to score, which is right: there is no passage to find an answer in.
     */
    function encodePair(query, passage, maxLength) {
      const max = maxLength || 256;
      let a = encodeText(query);
      let b = encodeText(passage);
      if (a.length > MAX_QUERY_TOKENS) a = a.slice(0, MAX_QUERY_TOKENS);
      if (!b.length) {
        const inputIds = [CLS].concat(a, [SEP]);
        return {
          inputIds,
          typeIds: new Array(inputIds.length).fill(0),
          mask: new Array(inputIds.length).fill(1),
          contextStart: -1,
        };
      }
      const budget = max - 4; // <s> + </s></s> + </s>
      if (a.length + b.length > budget) b = b.slice(0, Math.max(0, budget - a.length));

      const inputIds = [CLS].concat(a, [SEP, SEP], b, [SEP]);
      const contextStart = a.length + 3;
      const typeIds = new Array(contextStart).fill(0).concat(new Array(b.length + 1).fill(1));
      const mask = new Array(inputIds.length).fill(1);
      return { inputIds, typeIds, mask, contextStart };
    }

    /**
     * Pad a batch of encodings to a common width, as int64 for ONNX.
     * typeIds come out all zero on purpose: that is what RoBERTa wants (see
     * encodePair); the 1s in the encodings are for the caller, not the model.
     */
    function padBatch(encodings) {
      const width = Math.max.apply(null, encodings.map((e) => e.inputIds.length));
      const n = encodings.length;
      const inputIds = new BigInt64Array(n * width);
      const typeIds = new BigInt64Array(n * width); // zero-filled, stays that way
      const mask = new BigInt64Array(n * width);
      encodings.forEach((e, row) => {
        for (let i = 0; i < width; i++) {
          const at = row * width + i;
          inputIds[at] = BigInt(i < e.inputIds.length ? e.inputIds[i] : PAD);
          mask[at] = BigInt(i < e.mask.length ? e.mask[i] : 0);
        }
      });
      return { inputIds, typeIds, mask, dims: [n, width] };
    }

    return { encodeText, encodePair, padBatch, preTokenize, vocabSize: vocab.size, CLS, SEP, PAD, UNK };
  }

  return { create, preTokenize };
});

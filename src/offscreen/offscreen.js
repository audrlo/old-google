/* Old Google (2020) — offscreen inference host.
 *
 * Holds the DistilBERT-SQuAD session and answers scoring requests from the
 * service worker. For each (query, passage) pair it returns how strongly the
 * model believes an answer to the query is present in that passage: the best
 * span logit minus the [CLS] "no answer here" baseline, the standard SQuAD null
 * score. Higher means "the answer is in here".
 *
 * Nothing leaves the machine. The model file is bundled in the extension.
 */
(() => {
  'use strict';

  const MODEL = '/vendor/model/qa.onnx';
  const VOCAB = '/vendor/model/vocab.txt';
  const MAX_LEN = 320;
  const MAX_SPAN_TOKENS = 30;

  let ready = null;
  let session = null;
  let tokenizer = null;

  function init() {
    if (ready) return ready;
    ready = (async () => {
      // WASM only, single-threaded: extension pages are not cross-origin
      // isolated, so SharedArrayBuffer (and thus ORT's thread pool) is absent.
      self.ort.env.wasm.wasmPaths = '/vendor/ort/';
      self.ort.env.wasm.numThreads = 1;
      self.ort.env.wasm.simd = true;
      self.ort.env.logLevel = 'error';

      const vocabText = await (await fetch(VOCAB)).text();
      tokenizer = self.OGWordPiece.create(vocabText);
      session = await self.ort.InferenceSession.create(MODEL, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
      return true;
    })().catch((err) => {
      ready = null; // let a later attempt retry
      throw err;
    });
    return ready;
  }

  const UNSCORABLE = -1e6; // finite, sorts last, survives the message boundary

  /** Score one (query, passage) pair. */
  function scoreOne(encoding) {
    const ctxStart = encoding.typeIds.indexOf(1); // first passage token
    const ctxEnd = encoding.inputIds.length - 1; // trailing [SEP]
    if (ctxStart < 0 || ctxEnd <= ctxStart) return null; // nothing to answer from

    const batch = tokenizer.padBatch([encoding]);
    const tensor = (data) => new self.ort.Tensor('int64', data, batch.dims);
    const feeds = {
      input_ids: tensor(batch.inputIds),
      attention_mask: tensor(batch.mask),
    };
    // DistilBERT has no segment embeddings; other BERTs do.
    if (session.inputNames.includes('token_type_ids')) {
      feeds.token_type_ids = tensor(batch.typeIds);
    }
    return session.run(feeds).then((out) => {
      const start = out.start_logits.data;
      const end = out.end_logits.data;
      let best = -Infinity;
      for (let i = ctxStart; i < ctxEnd; i++) {
        const limit = Math.min(i + MAX_SPAN_TOKENS, ctxEnd);
        for (let j = i; j < limit; j++) {
          const v = start[i] + end[j];
          if (v > best) best = v;
        }
      }
      // Relative to the null span at [CLS]: "is there an answer here at all".
      return best - (start[0] + end[0]);
    });
  }

  /**
   * Passages are scored ONE AT A TIME, deliberately.
   *
   * Batching them padded every passage to the longest in the batch, and the
   * padding measurably moved the scores: the same passage scored 9.49 alone and
   * 9.06 batched, which was enough to flip the winner on a near-tie. A
   * passage's score must not depend on what happens to be scored beside it.
   *
   * @param {string} query
   * @param {string[]} passages
   * @returns {Promise<number[]>} one score per passage, in order
   */
  async function score(query, passages) {
    await init();
    if (!passages.length) return [];

    const scores = [];
    for (const passage of passages) {
      const encoding = tokenizer.encodePair(query, passage, MAX_LEN);
      const value = await scoreOne(encoding);
      scores.push(value === null ? UNSCORABLE : value);
    }
    return scores;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.target !== 'og-offscreen') return false;

    if (msg.type === 'og:score') {
      score(msg.query, msg.passages).then(
        (scores) => sendResponse({ ok: true, scores }),
        (err) => sendResponse({ ok: false, error: String((err && err.message) || err) })
      );
      return true;
    }

    if (msg.type === 'og:warm') {
      init().then(
        () => sendResponse({ ok: true }),
        (err) => sendResponse({ ok: false, error: String((err && err.message) || err) })
      );
      return true;
    }

    return false;
  });
})();

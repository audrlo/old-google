(() => {
  'use strict';

  const VOCAB = '/vendor/model/vocab.txt';
  const MAX_LEN = 320;
  const MAX_SPAN_TOKENS = 30;
  const UNSCORABLE = -1e6; // finite, sorts last, survives the message boundary

  const RUNTIMES = {
    webgpu: { script: '/vendor/ort/ort.webgpu.min.js', model: '/vendor/model/qa-fp16.onnx' },
    wasm: { script: '/vendor/ort/ort.wasm.min.js', model: '/vendor/model/qa-int8.onnx' },
  };

  let ready = null;
  let session = null;
  let tokenizer = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error('failed to load ' + src));
      document.head.appendChild(script);
    });
  }

  async function backend() {
    if (!navigator.gpu) return 'wasm';
    return (await navigator.gpu.requestAdapter()) ? 'webgpu' : 'wasm';
  }

  function init() {
    ready ??= (async () => {
      const kind = await backend();
      await loadScript(RUNTIMES[kind].script);
      self.ort.env.wasm.wasmPaths = '/vendor/ort/';
      self.ort.env.wasm.numThreads = 1;
      self.ort.env.logLevel = 'error';
      tokenizer = self.OGWordPiece.create(await (await fetch(VOCAB)).text());
      session = await self.ort.InferenceSession.create(RUNTIMES[kind].model, {
        executionProviders: [kind],
        graphOptimizationLevel: 'all',
      });
      return kind;
    })();
    return ready;
  }

  async function scoreOne(query, passage) {
    const encoding = tokenizer.encodePair(query, passage, MAX_LEN);
    const ctxStart = encoding.typeIds.indexOf(1);
    const ctxEnd = encoding.inputIds.length - 1; // trailing [SEP]
    if (ctxStart < 0 || ctxEnd <= ctxStart) return UNSCORABLE;

    const batch = tokenizer.padBatch([encoding]);
    const out = await session.run({
      input_ids: new self.ort.Tensor('int64', batch.inputIds, batch.dims),
      attention_mask: new self.ort.Tensor('int64', batch.mask, batch.dims),
    });
    const start = out.start_logits.data;
    const end = out.end_logits.data;
    let best = -Infinity;
    for (let i = ctxStart; i < ctxEnd; i++) {
      for (let j = i; j < Math.min(i + MAX_SPAN_TOKENS, ctxEnd); j++) {
        best = Math.max(best, start[i] + end[j]);
      }
    }
    return best;
  }

  async function score(query, passages) {
    await init();
    const scores = [];
    for (const passage of passages) scores.push(await scoreOne(query, passage));
    return scores;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.target !== 'og-offscreen') return false;
    const reply = (promise) => {
      promise.then(sendResponse, (err) => sendResponse({ ok: false, error: String(err.message || err) }));
      return true;
    };
    if (msg.type === 'og:score') return reply(score(msg.query, msg.passages).then((scores) => ({ ok: true, scores })));
    if (msg.type === 'og:warm') return reply(init().then((backend) => ({ ok: true, backend })));
    throw new Error('unknown offscreen message ' + msg.type);
  });
})();

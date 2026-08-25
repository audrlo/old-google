/* End-to-end test of the bundled model, inside a real browser with the real
 * extension loaded: content -> service worker -> offscreen document -> ONNX
 * Runtime (WASM) -> back. Nothing is stubbed, and no network is used.
 *
 * This is the only part of the extension that can be tested end-to-end without
 * Google, so it is worth doing properly.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const EXT = path.join(__dirname, '..');
const PROFILE = path.join(os.tmpdir(), 'og-inference-profile');

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

/* The passage that answers each query shares no content words with it — the
 * exact case keyword scoring cannot handle. */
const CASES = [
  {
    q: 'what do gazelles eat',
    want: 0,
    passages: [
      'Their diet consists mainly of grasses, shoots and the leaves of low shrubs, supplemented by acacia foliage in the dry season.',
      'Cheetahs, lions and wild dogs all hunt gazelle across the open savannah.',
      'Gazelles are found across the grasslands of Africa and in parts of southwest Asia.',
    ],
  },
  {
    q: 'why is the sky blue',
    want: 0,
    passages: [
      'Sunlight reaches the atmosphere and is scattered by gas molecules. Shorter wavelengths scatter far more than longer ones, so we see blue.',
      'People have wondered about the colour of the sky since antiquity, and many early explanations were proposed.',
    ],
  },
  {
    q: 'when was the great wall of china built',
    want: 0,
    passages: [
      'Work began under the Qin dynasty around 221 BC, and most of what survives today was raised during the Ming period.',
      'The fortification runs for more than 21,000 kilometres across northern China.',
    ],
  },
];

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });

  const context = await chromium.launchPersistentContext(PROFILE, {
    // The headless *shell* cannot load extensions; the full Chromium build can,
    // via the new headless mode.
    headless: true,
    channel: 'chromium',
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });

  // The MV3 service worker starts on demand; give it a moment to register.
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30000 });
  console.log('\nextension loaded');
  check('service worker is running', !!worker);

  const errors = [];
  worker.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  /* A service worker's sendMessage does not reach its own listener, so the test
   * calls the worker's scorePassages() directly. That still exercises the part
   * that can actually break: creating the offscreen document, loading 63 MB of
   * ONNX under WASM, tokenizing, and running inference. Only the SW's own
   * onMessage routing is bypassed. */
  const t0 = Date.now();
  const warm = await worker.evaluate(async () =>
    scorePassages('test', ['A short passage about testing.'])
  );
  const coldMs = Date.now() - t0;
  check('model loads and returns a score', warm && warm.ok && typeof warm.scores[0] === 'number', warm);
  console.log('       cold start (offscreen + 63MB model + first inference): ' + coldMs + 'ms');

  console.log('\nranking passages that share no words with the query');
  let correct = 0;
  let totalMs = 0;
  for (const c of CASES) {
    const t = Date.now();
    const res = await worker.evaluate(
      async ({ query, passages }) => scorePassages(query, passages),
      { query: c.q, passages: c.passages }
    );
    totalMs += Date.now() - t;
    if (!res || !res.ok) {
      check('"' + c.q + '"', false, res);
      continue;
    }
    const best = res.scores.indexOf(Math.max(...res.scores));
    const ok = best === c.want;
    if (ok) correct++;
    check('"' + c.q + '" picks the answering passage', ok, {
      picked: c.passages[best].slice(0, 60),
      scores: res.scores.map((s) => Number(s.toFixed(1))),
    });
  }
  console.log('       ' + correct + '/' + CASES.length + ' correct, ' + Math.round(totalMs / CASES.length) + 'ms per query warm (WASM)');

  console.log('\nscores must not depend on what else is in the batch');
  {
    const ps = CASES[0].passages;
    const together = await worker.evaluate(async (a) => scorePassages('what do gazelles eat', a), ps);
    const alone = [];
    for (const p of ps) {
      const r = await worker.evaluate(async (one) => scorePassages('what do gazelles eat', [one]), p);
      alone.push(r.scores[0]);
    }
    const withLong = await worker.evaluate(
      async (a) => scorePassages('what do gazelles eat', a.concat(['x '.repeat(140)])),
      ps
    );
    const drift = ps.map((_, i) => Math.abs(together.scores[i] - alone[i]));
    const padDrift = ps.map((_, i) => Math.abs(together.scores[i] - withLong.scores[i]));
    check('scored together == scored individually', Math.max(...drift) < 1e-6, {
      together: together.scores, alone,
    });
    check('a long passage alongside changes nothing', Math.max(...padDrift) < 1e-6, {
      without: together.scores, with: withLong.scores,
    });
  }

  console.log('\nrobustness');
  const empty = await worker.evaluate(async () => scorePassages('x', []));
  check('empty passage list returns no scores', empty && empty.ok && empty.scores.length === 0, empty);

  const long = 'word '.repeat(4000);
  const longRes = await worker.evaluate(async (p) => scorePassages('anything at all', [p]), long);
  check('an over-long passage is truncated, not fatal', longRes && longRes.ok && Number.isFinite(longRes.scores[0]), longRes);

  const weird = await worker.evaluate(async () =>
    scorePassages('', ['', '   ', 'a real passage about testing things'])
  );
  check('empty passages score as unscorable rather than throwing',
    weird && weird.ok && weird.scores.length === 3 && weird.scores[0] === -1e6 && weird.scores[1] === -1e6,
    weird);
  check('a real passage alongside empties still scores', weird && weird.scores[2] > -1e6, weird);

  check('no errors logged by the worker', errors.length === 0, errors.slice(0, 3));

  await context.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('\nharness failed: ' + err.message);
  process.exit(1);
});

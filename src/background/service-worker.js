/**
 * Old Google (2020) — background service worker.
 *
 * Single job: fetch one third-party page on behalf of the content script so a
 * classic featured snippet can be quoted from it. Content scripts can't do this
 * cross-origin, and the page HTML is never executed — the content script parses
 * it with an inert DOMParser and only ever inserts textContent.
 */

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB is plenty for an article's <head>+<body>
const TIMEOUT_MS = 9000;
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MIN_GAP_PER_HOST_MS = 1500;  // be a polite neighbour

const memCache = new Map(); // url -> { at, payload }
const lastHit = new Map();  // host -> timestamp
const inFlight = new Map(); // url -> Promise

function now() {
  return Date.now();
}

function cacheKey(url) {
  return 'og:page:' + url;
}

async function readCache(url) {
  const hit = memCache.get(url);
  if (hit && now() - hit.at < TTL_MS) return hit.payload;
  try {
    const stored = await chrome.storage.session.get(cacheKey(url));
    const rec = stored[cacheKey(url)];
    if (rec && now() - rec.at < TTL_MS) {
      memCache.set(url, rec);
      return rec.payload;
    }
  } catch (_) {
    /* session storage unavailable — memory cache is enough */
  }
  return null;
}

async function writeCache(url, payload) {
  const rec = { at: now(), payload };
  memCache.set(url, rec);
  if (memCache.size > 60) memCache.delete(memCache.keys().next().value);
  try {
    await chrome.storage.session.set({ [cacheKey(url)]: rec });
  } catch (_) {
    /* non-fatal */
  }
}

async function politeDelay(host) {
  const last = lastHit.get(host) || 0;
  const wait = MIN_GAP_PER_HOST_MS - (now() - last);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(host, now());
}

/** Read at most MAX_BYTES of the body, decoding as UTF-8. */
async function readCapped(response) {
  if (!response.body) return await response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let out = '';
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (total >= MAX_BYTES) {
      try {
        await reader.cancel();
      } catch (_) {}
      break;
    }
  }
  out += decoder.decode();
  return out;
}

async function fetchPage(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch (_) {
    return { ok: false, error: 'bad-url' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: 'bad-scheme' };
  }

  const cached = await readCache(url.href);
  if (cached) return { ...cached, cached: true };

  if (inFlight.has(url.href)) return inFlight.get(url.href);

  const job = (async () => {
    await politeDelay(url.host);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url.href, {
        signal: ctrl.signal,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'follow',
        referrerPolicy: 'no-referrer',
        headers: { Accept: 'text/html,application/xhtml+xml' },
      });
      if (!res.ok) return { ok: false, error: 'http-' + res.status };

      const type = (res.headers.get('content-type') || '').toLowerCase();
      if (!type.includes('html') && !type.includes('xml') && type !== '') {
        return { ok: false, error: 'not-html' };
      }
      // Honour a site's wish not to be excerpted.
      const robots = (res.headers.get('x-robots-tag') || '').toLowerCase();
      if (robots.includes('nosnippet') || robots.includes('noarchive')) {
        return { ok: false, error: 'nosnippet' };
      }

      const html = await readCapped(res);
      const payload = { ok: true, html, finalUrl: res.url || url.href };
      await writeCache(url.href, payload);
      return payload;
    } catch (err) {
      return { ok: false, error: err && err.name === 'AbortError' ? 'timeout' : 'network' };
    } finally {
      clearTimeout(timer);
      inFlight.delete(url.href);
    }
  })();

  inFlight.set(url.href, job);
  return job;
}

/** JSON sibling of fetchPage, for the dictionary lookup. */
async function fetchJson(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch (_) {
    return { ok: false, error: 'bad-url' };
  }
  if (url.protocol !== 'https:') return { ok: false, error: 'bad-scheme' };

  const cached = await readCache(url.href);
  if (cached) return { ...cached, cached: true };

  await politeDelay(url.host);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url.href, {
      signal: ctrl.signal,
      credentials: 'omit',
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json' },
    });
    if (res.status === 404) return { ok: false, error: 'not-found' };
    if (!res.ok) return { ok: false, error: 'http-' + res.status };
    const text = await readCapped(res);
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      return { ok: false, error: 'bad-json' };
    }
    const payload = { ok: true, data };
    await writeCache(url.href, payload);
    return payload;
  } catch (err) {
    return { ok: false, error: err && err.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------- offscreen inference host ---------------------- */

const OFFSCREEN_PATH = 'src/offscreen/offscreen.html';
let offscreenReady = null;

async function hasOffscreen() {
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    return contexts.length > 0;
  }
  return false;
}

/** Create the offscreen document once; concurrent callers share the attempt. */
function ensureOffscreen() {
  if (offscreenReady) return offscreenReady;
  offscreenReady = (async () => {
    if (await hasOffscreen()) return true;
    try {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_PATH,
        reasons: ['WORKERS'],
        justification: 'Runs the local question-answering model that ranks candidate snippet passages.',
      });
    } catch (err) {
      // Another worker invocation may have created it between the check and here.
      if (!/already/i.test(String(err))) {
        offscreenReady = null;
        throw err;
      }
    }
    return true;
  })().catch((err) => {
    offscreenReady = null;
    throw err;
  });
  return offscreenReady;
}

async function scorePassages(query, passages) {
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({
    target: 'og-offscreen',
    type: 'og:score',
    query,
    passages,
  });
  if (!res || !res.ok) return { ok: false, error: (res && res.error) || 'no-response' };
  return res;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Messages addressed to the offscreen document are not ours to handle.
  if (msg && msg.target === 'og-offscreen') return false;

  if (msg && msg.type === 'og:score') {
    scorePassages(msg.query, msg.passages).then(sendResponse, (err) =>
      sendResponse({ ok: false, error: String((err && err.message) || err) })
    );
    return true;
  }

  if (msg && msg.type === 'og:fetchJson') {
    fetchJson(msg.url).then(sendResponse, (err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (!msg || msg.type !== 'og:fetch') return false;
  fetchPage(msg.url).then(sendResponse, (err) =>
    sendResponse({ ok: false, error: String((err && err.message) || err) })
  );
  return true; // async
});

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB is plenty for an article's <head>+<body>
const TIMEOUT_MS = 9000;
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MIN_GAP_PER_HOST_MS = 1500;  // be a polite neighbour

const memCache = new Map(); // url -> { at, payload }
const lastHit = new Map();  // host -> timestamp
const inFlight = new Map(); // url -> Promise

const cacheKey = (url) => 'og:page:' + url;

async function readCache(url) {
  const hit = memCache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.payload;
  const rec = (await chrome.storage.session.get(cacheKey(url)))[cacheKey(url)];
  if (!rec || Date.now() - rec.at >= TTL_MS) return null;
  memCache.set(url, rec);
  return rec.payload;
}

async function writeCache(url, payload) {
  const rec = { at: Date.now(), payload };
  memCache.set(url, rec);
  if (memCache.size > 60) memCache.delete(memCache.keys().next().value);
  await chrome.storage.session.set({ [cacheKey(url)]: rec });
}

async function politeDelay(host) {
  const wait = MIN_GAP_PER_HOST_MS - (Date.now() - (lastHit.get(host) ?? 0));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(host, Date.now());
}

function get(url, headers) {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return fetch(url, { signal: ctrl.signal, credentials: 'omit', cache: 'no-store', redirect: 'follow', referrerPolicy: 'no-referrer', headers });
}

const failure = (err) => ({ ok: false, error: err.name === 'AbortError' ? 'timeout' : 'network' });

async function readCapped(response) {
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
      await reader.cancel();
      break;
    }
  }
  return out + decoder.decode();
}

async function fetchPage(rawUrl) {
  const url = new URL(rawUrl);
  const cached = await readCache(url.href);
  if (cached) return cached;
  if (inFlight.has(url.href)) return inFlight.get(url.href);

  const job = (async () => {
    await politeDelay(url.host);
    try {
      const res = await get(url.href, { Accept: 'text/html,application/xhtml+xml' });
      if (!res.ok) return { ok: false, error: 'http-' + res.status };
      const type = (res.headers.get('content-type') ?? '').toLowerCase();
      if (type && !type.includes('html') && !type.includes('xml')) return { ok: false, error: 'not-html' };
      const robots = (res.headers.get('x-robots-tag') ?? '').toLowerCase();
      if (robots.includes('nosnippet') || robots.includes('noarchive')) return { ok: false, error: 'nosnippet' };
      const payload = { ok: true, html: await readCapped(res), finalUrl: res.url };
      await writeCache(url.href, payload);
      return payload;
    } catch (err) {
      return failure(err);
    } finally {
      inFlight.delete(url.href);
    }
  })();

  inFlight.set(url.href, job);
  return job;
}

async function fetchJson(url, headers) {
  const cached = await readCache(url);
  if (cached) return cached;
  try {
    const res = await get(url, { Accept: 'application/json', ...headers });
    if (res.status === 404) return { ok: false, error: 'not-found' };
    if (!res.ok) return { ok: false, error: 'http-' + res.status };
    const payload = { ok: true, data: JSON.parse(await readCapped(res)) };
    await writeCache(url, payload);
    return payload;
  } catch (err) {
    return failure(err);
  }
}

let offscreenReady = null;

function ensureOffscreen() {
  offscreenReady ??= (async () => {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (contexts.length) return;
    await chrome.offscreen.createDocument({
      url: 'src/offscreen/offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Runs the local question-answering model that ranks candidate snippet passages.',
    }).catch((err) => {
      if (!/already/i.test(String(err))) throw err;
    });
  })().catch((err) => {
    offscreenReady = null;
    throw err;
  });
  return offscreenReady;
}

async function scorePassages(query, passages) {
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({ target: 'og-offscreen', type: 'og:score', query, passages });
  return res ?? { ok: false, error: 'no-response' };
}

const HIGHLIGHT_TTL_MS = 30 * 1000;
const HIGHLIGHT_CSS = '::target-text { background-color: #e5d4f6 !important; color: #202124 !important; }';
const pendingHighlights = new Map(); // origin + pathname -> expiry

function highlightKey(url) {
  const u = new URL(url);
  return u.origin + u.pathname;
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== 'complete') return;
  const until = pendingHighlights.get(highlightKey(tab.url));
  if (!until) return;
  pendingHighlights.delete(highlightKey(tab.url));
  if (until > Date.now()) chrome.scripting.insertCSS({ target: { tabId }, css: HIGHLIGHT_CSS });
});

let emojiTable = null;
async function emoji() {
  emojiTable ??= await (await fetch(chrome.runtime.getURL('data/emoji.json'))).json();
  return { ok: true, table: emojiTable };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target === 'og-offscreen') return false;
  const reply = (promise) => {
    promise.then(sendResponse, (err) => sendResponse({ ok: false, error: String(err.message ?? err) }));
    return true; // async
  };
  switch (msg.type) {
    case 'og:fetch': return reply(fetchPage(msg.url));
    case 'og:fetchJson': return reply(fetchJson(msg.url, msg.headers));
    case 'og:score': return reply(scorePassages(msg.query, msg.passages));
    case 'og:emojiTable': return reply(emoji());
    case 'og:highlight':
      pendingHighlights.set(highlightKey(msg.url), Date.now() + HIGHLIGHT_TTL_MS);
      return false;
    default:
      throw new Error('unknown message ' + msg.type);
  }
});

/* Old Google (2020) — shared state, settings and helpers. Runs at document_start. */
(() => {
  const OG = (window.OG = window.OG || {});

  OG.DEFAULTS = {
    theme: true,               // 2020 skin
    hideAI: true,              // remove AI Overview / AI Mode
    followDark: true,          // match Google's theme instead of forcing white
    pagination: true,          // classic Gooooooogle numbered pages
    hideFooter: true,          // drop the "Results are not personalized" bar
    dictionary: true,          // built-in definition / synonym panel
    oxfordAppId: '',           // Oxford Languages API credentials; empty = Wiktionary + Datamuse
    oxfordAppKey: '',
    oxfordSandbox: false,      // Oxford's free sandbox host (words starting with 'a' only)
    rerank: true,              // rank snippet passages with the bundled QA model
    greenUrls: false,          // 2010-style green URLs instead of 2020 grey
    snippetMode: 'synthesize', // 'off' | 'google' | 'synthesize'
    preferWikipedia: false,
    extraHideSelectors: '',
    customCss: '',
    debug: false,
  };

  OG.settings = Object.assign({}, OG.DEFAULTS);
  OG.settingsLoaded = false;

  function area() {
    try {
      if (chrome.storage && chrome.storage.sync) return chrome.storage.sync;
    } catch (_) {}
    return chrome.storage.local;
  }
  OG.storageArea = area;

  OG.loadSettings = async function () {
    try {
      const stored = await area().get(OG.DEFAULTS);
      Object.assign(OG.settings, stored);
    } catch (_) {
      try {
        Object.assign(OG.settings, await chrome.storage.local.get(OG.DEFAULTS));
      } catch (_) {}
    }
    OG.settingsLoaded = true;
    return OG.settings;
  };

  OG.log = function (...args) {
    if (OG.settings.debug) console.log('%c[old-google]', 'color:#1a73e8;font-weight:bold', ...args);
  };

  /* ---------- page helpers ---------- */

  OG.isSearchPage = function () {
    const p = location.pathname;
    if (p !== '/search' && p !== '/webhp' && p !== '/') return false;
    if (p === '/' || p === '/webhp') return !location.search.includes('q=');
    return true;
  };
  OG.isResultsPage = function () {
    return location.pathname === '/search' && new URLSearchParams(location.search).has('q');
  };
  /**
   * True only on the text-results tab. Images / Videos / Shopping / News have a
   * completely different layout — no 652px column, no right rail — so the 2020
   * column geometry must not be forced on them or the page overflows sideways.
   */
  OG.isWebTab = function () {
    const p = new URLSearchParams(location.search);
    if (p.get('tbm')) return false;          // legacy vertical param
    const udm = p.get('udm');                // 2=images, 7=videos, 12=news, ...
    if (udm && udm !== '14') return false;   // 14 is the plain Web filter
    return true;
  };

  OG.query = function () {
    return new URLSearchParams(location.search).get('q') || '';
  };
  OG.startIndex = function () {
    return parseInt(new URLSearchParams(location.search).get('start') || '0', 10) || 0;
  };

  /* ---------- dom helpers ---------- */

  OG.el = function (tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      for (const k in props) {
        if (k === 'class') node.className = props[k];
        else if (k === 'text') node.textContent = props[k];
        else if (k === 'style') node.setAttribute('style', props[k]);
        else if (k.startsWith('on') && typeof props[k] === 'function') node.addEventListener(k.slice(2), props[k]);
        else if (props[k] != null) node.setAttribute(k, props[k]);
      }
    }
    for (const c of [].concat(children || [])) {
      if (c == null) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    node.setAttribute('data-og', '1');
    return node;
  };

  OG.qsa = function (sel, root) {
    try {
      return Array.from((root || document).querySelectorAll(sel));
    } catch (_) {
      return [];
    }
  };

  OG.throttle = function (fn, ms) {
    let queued = false;
    let last = 0;
    return function () {
      const wait = ms - (Date.now() - last);
      if (wait <= 0) {
        last = Date.now();
        fn();
      } else if (!queued) {
        queued = true;
        setTimeout(() => {
          queued = false;
          last = Date.now();
          fn();
        }, wait);
      }
    };
  };

  /** Toggle the html classes the stylesheets key off. Called before first paint. */
  OG.applyClasses = function () {
    const s = OG.settings;
    const root = document.documentElement;
    const on = OG.isSearchPage();
    root.classList.toggle('og-2020', on && s.theme);
    root.classList.toggle('og-hide-ai', on && s.hideAI);
    // Before the DOM exists we can only guess from the OS preference;
    // OG.detectTheme() corrects this by measuring Google's own header.
    const prefersDark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    root.classList.toggle('og-dark', on && s.theme && s.followDark && prefersDark);
    root.classList.toggle('og-green-urls', on && s.theme && s.greenUrls);
    root.classList.toggle('og-hide-footer', on && s.hideFooter);
    root.classList.toggle('og-web', on && s.theme && OG.isWebTab());
  };

  /** User-supplied selectors + custom CSS live in one <style> we own. */
  OG.applyUserCss = function () {
    const s = OG.settings;
    let css = '';
    const extra = (s.extraHideSelectors || '')
      .split(/[\n,]+/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (extra.length && s.hideAI) css += extra.join(',\n') + ' { display: none !important; }\n';
    if (s.customCss) css += s.customCss + '\n';

    let tag = document.getElementById('og-user-css');
    if (!css) {
      if (tag) tag.remove();
      return;
    }
    if (!tag) {
      tag = document.createElement('style');
      tag.id = 'og-user-css';
      (document.head || document.documentElement).appendChild(tag);
    }
    tag.textContent = css;
  };

  // Optimistic: defaults are "on", so apply immediately at document_start to
  // avoid a flash of 2026 Google, then correct once storage answers.
  OG.applyClasses();
})();

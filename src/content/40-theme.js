/* Old Google (2020) — DOM-side theming.
 *
 * Google's CSS class names are obfuscated and churn constantly, so instead of
 * betting the stylesheet on them we walk the results once and stamp our own
 * stable hooks (og-result / og-title / og-cite / og-snippet). The stylesheet
 * targets those. We also rebuild the two things 2026 Google deleted outright:
 * the numbered "Gooooooogle" pager and the classic tab strip.
 */
(() => {
  const OG = window.OG;

  const O_COLORS = ['#EA4335', '#FBBC05', '#4285F4', '#34A853'];

  /* --------------------------- theme sensing -------------------------- */

  function relativeLuminance(css) {
    const m = /rgba?\(([^)]+)\)/.exec(css || '');
    if (!m) return null;
    const parts = m[1].split(',').map((n) => parseFloat(n));
    if (parts.length < 3 || parts.some(isNaN)) return null;
    if (parts.length > 3 && parts[3] === 0) return null; // fully transparent
    const channel = (v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(parts[0]) + 0.7152 * channel(parts[1]) + 0.0722 * channel(parts[2]);
  }
  OG.relativeLuminance = relativeLuminance;

  /**
   * Is Google in dark mode?
   *
   * Measured from the search field's own text colour. The header is the one
   * thing the extension never restyles, so its colours are Google's and can be
   * trusted; light text there means a dark theme. Until the DOM exists,
   * 00-state.js guesses from the OS preference and this corrects it.
   */
  OG.detectTheme = function () {
    const root = document.documentElement;
    if (!OG.settings.theme || !OG.settings.followDark) {
      root.classList.remove('og-dark');
      return;
    }
    const field = document.querySelector('input[name="q"], textarea[name="q"]');
    if (!field) return; // keep the OS-preference guess
    const lum = relativeLuminance(getComputedStyle(field).color);
    if (lum === null) return;
    root.classList.toggle('og-dark', lum > 0.5); // light text on a dark ground
  };

  /* ------------------------- stable hooks ---------------------------- */

  /**
   * Align the results column with Google's own tab strip.
   *
   * The gutter used to be padding on #cnt/#rcnt, but the tab strip lives inside
   * those, so it was shifted along with the results — the rule under the tabs
   * started 180px in instead of at the window edge, and switching to a tab that
   * did not get the gutter made the whole header jump sideways.
   *
   * So measure where Google actually puts the tabs and offset only the columns
   * to match. That keeps the two aligned on every tab and at every width, and
   * leaves the header untouched, which is the rule everywhere else here.
   */
  OG.markColumns = function () {
    const root = document.documentElement;
    for (const stale of OG.qsa('.og-offset, .og-foot-bleed')) {
      stale.classList.remove('og-offset');
      stale.classList.remove('og-foot-bleed');
    }

    // The tab links: the only /search links sitting near the top of the page.
    // Taking the nav's first <a> instead measured a hidden one, whose rect is
    // 0x0 at the origin — so the gutter came out as 0 and every result sat
    // flush against the left edge.
    const edges = [];
    for (const link of OG.qsa('a[href*="/search"]')) {
      if (link.hasAttribute('data-og-hidden')) continue;
      if (link.checkVisibility && !link.checkVisibility()) continue;
      const rect = link.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) continue; // hidden or collapsed
      if (rect.top > 300) continue; // below the tab strip: a result link
      // The link's own padding sits inside its box; the text edge is what the
      // eye actually lines up against.
      const padding = parseFloat(getComputedStyle(link).paddingLeft) || 0;
      edges.push(Math.round(rect.left + padding));
    }

    // One stray link is not a tab strip. Require a few before trusting it.
    let gutter = 180; // the 2020 value, and the fallback
    if (edges.length >= 2) {
      const left = Math.min.apply(null, edges);
      if (left > 0 && left <= 400) gutter = left;
    }
    root.style.setProperty('--og-gutter', gutter + 'px');
  };

  /**
   * Google ships an #rhs container on every SERP, empty when there is no
   * knowledge panel. Giving every child the panel's border drew a stray hairline
   * across the page, so only children with actual content get styled.
   */
  OG.markKnowledgePanel = function () {
    const rhs = document.getElementById('rhs');
    if (!rhs) return;
    let content = false;
    for (const child of Array.from(rhs.children)) {
      const hasText = (child.textContent || '').trim().length > 2;
      const hasMedia = !!child.querySelector('img, svg, canvas');
      if (hasText || hasMedia) {
        child.classList.add('og-kp');
        child.removeAttribute('data-og-hidden');
        content = true;
      } else {
        child.classList.remove('og-kp');
        child.setAttribute('data-og-hidden', 'empty');
      }
    }
    rhs.classList.toggle('og-kp-empty', !content);
  };

  /**
   * 2020 showed a bare favicon. Google now seats it in a bordered rounded
   * plate. Mark the icon, plus the wrappers around it that hold nothing but the
   * icon, so the plate can be flattened without touching anything with text in
   * it.
   */
  function stripFaviconChrome(block) {
    const cite = block.querySelector('cite');
    if (!cite) return;
    let host = cite.parentElement;
    for (let i = 0; i < 4 && host && !host.querySelector('img, svg'); i++) {
      host = host.parentElement;
    }
    if (!host) return;
    for (const icon of OG.qsa('img, svg', host)) {
      const box = icon.getBoundingClientRect();
      if (box.width > 32 || box.height > 32) continue; // not a favicon
      icon.classList.add('og-favicon');
      let node = icon.parentElement;
      for (let i = 0; i < 3 && node && node !== host; i++) {
        if ((node.textContent || '').trim().length !== 0) break;
        node.classList.add('og-nochrome');
        node = node.parentElement;
      }
    }
  }

  /**
   * 2020 showed one line above the title: favicon + full breadcrumb. Today
   * Google stacks a site name above the URL and adds an "About this result"
   * menu. Collapse it back, structurally rather than by class name: the site
   * name is the short, URL-less element immediately before the cite.
   */
  function collapseSiteHeader(block) {
    const cite = block.querySelector('cite');
    if (!cite) return;
    const wrap = cite.parentElement;
    if (!wrap) return;
    const prev = wrap.previousElementSibling;
    if (!prev || prev.hasAttribute('data-og-hidden')) return;
    const text = (prev.textContent || '').trim();
    if (!text || text.length > 60) return;
    if (/[\/\u203a]|https?:/.test(text)) return;      // that's a URL, keep it
    if (prev.querySelector('cite, h3, img, svg')) return; // favicon/title, keep
    prev.setAttribute('data-og-hidden', 'sitename');
  }

  OG.markResults = function () {
    const rso = document.getElementById('rso');
    if (!rso) return;

    for (const h3 of OG.qsa('h3', rso)) {
      if (h3.closest('#og-featured')) continue;
      const link = h3.closest('a[href]');
      if (!link) continue;
      const block = h3.closest('div.g, div.MjjYud, div[data-hveid]');
      if (block && !block.classList.contains('og-result')) block.classList.add('og-result');
      h3.classList.add('og-title');
      link.classList.add('og-title-link');

      if (block) {
        const cite = block.querySelector('cite');
        if (cite) cite.classList.add('og-cite');
        collapseSiteHeader(block);
        stripFaviconChrome(block);
        const snippet = block.querySelector('.VwiC3b, [data-sncf], [data-snf], .lyLwlc');
        if (snippet) snippet.classList.add('og-snippet');
      }
    }

    for (const menu of OG.qsa('#rso [aria-label*="About this result"], #rso [aria-label*="About this Result"]')) {
      const btn = menu.closest('[role="button"], [jsaction]') || menu;
      if ((btn.textContent || '').trim().length < 3) btn.setAttribute('data-og-hidden', 'about');
    }

    // The header — search box, tab strip, the rule under it — is deliberately
    // left alone. See the note in theme-2020.css.
  };

  /* --------------------------- pagination ---------------------------- */

  function pageUrl(start) {
    const url = new URL(location.href);
    if (start > 0) url.searchParams.set('start', String(start));
    else url.searchParams.delete('start');
    url.searchParams.delete('sei');
    return url.href;
  }

  function buildPager() {
    const current = Math.floor(OG.startIndex() / 10);
    const first = Math.max(0, current - 4);
    const count = 10;

    const table = OG.el('div', { class: 'og-pager', role: 'navigation', 'aria-label': 'Page navigation' });

    const prev = OG.el('div', { class: 'og-pager-prev' });
    if (current > 0) {
      prev.appendChild(
        OG.el('a', { href: pageUrl((current - 1) * 10), class: 'og-pager-nav' }, [
          OG.el('span', { class: 'og-pager-arrow', text: '‹' }),
          OG.el('span', { text: 'Previous' }),
        ])
      );
    }
    table.appendChild(prev);

    // The logo: G + one 'o' per page + gle, each 'o' a page link.
    const logo = OG.el('div', { class: 'og-pager-logo' });
    logo.appendChild(OG.el('span', { class: 'og-pager-letter og-blue', text: 'G' }));
    for (let i = 0; i < count; i++) {
      const page = first + i;
      const isCurrent = page === current;
      const letter = OG.el(isCurrent ? 'span' : 'a', {
        class: 'og-pager-o' + (isCurrent ? ' og-pager-current' : ''),
        href: isCurrent ? null : pageUrl(page * 10),
        'aria-label': 'Page ' + (page + 1),
        style: 'color:' + O_COLORS[i % O_COLORS.length],
      });
      letter.appendChild(OG.el('span', { class: 'og-pager-glyph', text: 'o' }));
      letter.appendChild(OG.el('span', { class: 'og-pager-num', text: String(page + 1) }));
      logo.appendChild(letter);
    }
    logo.appendChild(OG.el('span', { class: 'og-pager-letter og-blue', text: 'g' }));
    logo.appendChild(OG.el('span', { class: 'og-pager-letter og-green', text: 'l' }));
    logo.appendChild(OG.el('span', { class: 'og-pager-letter og-red', text: 'e' }));
    table.appendChild(logo);

    table.appendChild(
      OG.el('div', { class: 'og-pager-next' }, [
        OG.el('a', { href: pageUrl((current + 1) * 10), class: 'og-pager-nav' }, [
          OG.el('span', { text: 'Next' }),
          OG.el('span', { class: 'og-pager-arrow', text: '›' }),
        ]),
      ])
    );

    return table;
  }

  OG.buildPagination = function () {
    if (!OG.settings.pagination || !OG.isResultsPage() || !OG.isWebTab()) return;
    const existing = document.getElementById('og-pager-wrap');
    if (existing && existing.isConnected) return;
    if (existing) existing.remove();

    const anchor = document.getElementById('botstuff') || document.getElementById('rso');
    if (!anchor) return;
    // Only page once results are on screen.
    if (!document.querySelector('#rso h3')) return;

    const wrap = OG.el('div', { id: 'og-pager-wrap' }, [buildPager()]);
    if (anchor.id === 'botstuff') anchor.appendChild(wrap);
    else anchor.parentNode.insertBefore(wrap, anchor.nextSibling);

    // Google's own "More results" button / infinite scroll sentinel.
    for (const node of OG.qsa('#botstuff [role="button"], .GNJvt, .T7sFge, #pnnext')) {
      const label = (node.textContent || '').trim().toLowerCase();
      if (label === 'more results' || label === 'show more results') {
        const block = node.closest('div[data-hveid], div') || node;
        block.setAttribute('data-og-hidden', 'more');
      }
    }
  };

  /* ------------------------------ misc ------------------------------- */

  /** 2020 said "About 12,300,000 results (0.51 seconds)" right under the tabs. */
  OG.fixStats = function () {
    const stats = document.getElementById('result-stats');
    if (stats) stats.classList.add('og-stats');
  };

  OG.theme = function () {
    OG.detectTheme();
    OG.markColumns();
    OG.markKnowledgePanel();
    OG.markResults();
    OG.fixStats();
  };
})();

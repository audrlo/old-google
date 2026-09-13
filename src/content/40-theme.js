(() => {
  const OG = window.OG;

  const O_COLORS = ['#EA4335', '#FBBC05', '#4285F4', '#34A853'];

  function relativeLuminance(css) {
    const m = /rgba?\(([^)]+)\)/.exec(css);
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

  OG.markColumns = function () {
    const root = document.documentElement;
    for (const stale of OG.qsa('.og-offset, .og-foot-bleed')) {
      stale.classList.remove('og-offset');
      stale.classList.remove('og-foot-bleed');
    }

    const edges = [];
    for (const link of OG.qsa('a[href*="/search"]')) {
      if (link.hasAttribute('data-og-hidden') || !link.checkVisibility()) continue;
      const rect = link.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) continue; // hidden or collapsed
      if (rect.top > 300) continue; // below the tab strip: a result link
      edges.push(Math.round(rect.left + parseFloat(getComputedStyle(link).paddingLeft)));
    }

    let gutter = 180; // the 2020 value, and the fallback
    if (edges.length >= 2) {
      const left = Math.min(...edges);
      if (left > 0 && left <= 400) gutter = left;
    }
    root.style.setProperty('--og-gutter', gutter + 'px');
  };

  OG.markKnowledgePanel = function () {
    const rhs = document.getElementById('rhs');
    if (!rhs) return;
    let content = false;
    for (const child of Array.from(rhs.children)) {
      const hasText = child.textContent.trim().length > 2;
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
        if (node.textContent.trim().length !== 0) break;
        node.classList.add('og-nochrome');
        node = node.parentElement;
      }
    }
  }

  function collapseSiteHeader(block) {
    const cite = block.querySelector('cite');
    if (!cite) return;
    const prev = cite.parentElement.previousElementSibling;
    if (!prev || prev.hasAttribute('data-og-hidden')) return;
    const text = prev.textContent.trim();
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
      if (!block) continue;
      const cite = block.querySelector('cite');
      if (!cite) continue; // shopping/product cards also use linked h3 headings
      h3.classList.add('og-title');
      link.classList.add('og-title-link');
      block.classList.add('og-result');
      cite.classList.add('og-cite');
      collapseSiteHeader(block);
      stripFaviconChrome(block);
      block.querySelector('.VwiC3b, [data-sncf], [data-snf], .lyLwlc')?.classList.add('og-snippet');
    }

    for (const menu of OG.qsa('#rso [aria-label*="About this result"], #rso [aria-label*="About this Result"]')) {
      const btn = menu.closest('[role="button"], [jsaction]') || menu;
      if (btn.textContent.trim().length < 3) btn.setAttribute('data-og-hidden', 'about');
    }
  };

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
    if (document.getElementById('og-pager-wrap')) return;

    const anchor = document.getElementById('botstuff') || document.getElementById('rso');
    if (!anchor) return;
    if (!document.querySelector('#rso h3')) return;

    const wrap = OG.el('div', { id: 'og-pager-wrap' }, [buildPager()]);
    if (anchor.id === 'botstuff') anchor.appendChild(wrap);
    else anchor.parentNode.insertBefore(wrap, anchor.nextSibling);

    for (const node of OG.qsa('#botstuff [role="button"], .GNJvt, .T7sFge, #pnnext')) {
      const label = node.textContent.trim().toLowerCase();
      if (label === 'more results' || label === 'show more results') {
        const block = node.closest('div[data-hveid], div') || node;
        block.setAttribute('data-og-hidden', 'more');
      }
    }
  };

  OG.theme = function () {
    OG.detectTheme();
    OG.markColumns();
    OG.markKnowledgePanel();
    OG.markResults();
    document.getElementById('result-stats')?.classList.add('og-stats');
  };
})();

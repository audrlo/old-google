/* Old Google (2020) — the featured snippet box.
 *
 * Order of preference:
 *   1. A real featured snippet Google still served (re-rendered in 2020 dress).
 *   2. A passage extracted from the top organic result's own page.
 *   3. The top result's index description, quoted as-is.
 * In every case the box shows exactly one source, with attribution.
 *
 * Every card is one of three shapes, all with url, host, title, favicon and origin:
 *   {kind: 'paragraph', text, bold: null | {start, end}}
 *   {kind: 'list', heading, ordered, items}
 *   {kind: 'table', heading, grid}
 */
(() => {
  const OG = window.OG;

  const GOOGLE_HOST = /(^|\.)google(\.[a-z]{2,3}){1,2}$/i;

  const state = { key: null, status: 'idle', data: null }; // status: idle | pending | done

  /* --------------------------- result harvesting -------------------- */

  function isAd(node) {
    return !!node.closest(
      '#tads,#tadsb,#bottomads,#taw,[data-text-ad],[aria-label="Ads"],[data-dtld],.commercial-unit-desktop-top'
    );
  }

  function isQuestionBlock(node) {
    return !!node.closest(
      '.related-question-pair,[jsname="Cpkphb"],[data-initq],[data-q],#botstuff [role="heading"]'
    );
  }

  /** The link's destination if it leaves Google, else null. */
  function externalHref(a) {
    const href = a.getAttribute('href');
    if (href.startsWith('#') || href.startsWith('/')) return null;
    const u = new URL(href, location.href);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (GOOGLE_HOST.test(u.hostname)) return null;
    if (/googleadservices|doubleclick|\/aclk/.test(u.href)) return null;
    return u.href;
  }

  /**
   * The snippet text under a result.
   *
   * Taking the first element matching a known class is not safe: those names get
   * reused on wrapper divs, and matching a wrapper yields the title, site name
   * and URL run together into one string ("Gazelle Eating HabitsSquaw Mountain
   * Ranchhttps://..."). So every candidate must look like prose: it may not
   * contain the title, a cite, or a bare URL.
   */
  function descriptionFor(block, h3) {
    const looksLikeChrome = (node) => node.contains(h3) || node.querySelector('h3, cite') || /https?:\/\//.test(node.textContent);
    let best = '';
    for (const node of OG.qsa('.VwiC3b, [data-sncf], [data-snf], .lyLwlc, .yDYNvb', block)) {
      if (looksLikeChrome(node)) continue;
      const text = node.textContent.replace(/\s+/g, ' ').trim();
      if (text.length > best.length && text.length <= 600) best = text;
    }
    return best;
  }

  /** The organic results, in page order. */
  OG.organicResults = function () {
    const out = [];
    const seen = new Set();
    const container = OG.column() || document.body;

    for (const h3 of OG.qsa('h3', container)) {
      if (isAd(h3) || isQuestionBlock(h3)) continue;
      const a = h3.closest('a[href]') || h3.parentElement.querySelector('a[href]');
      const url = a && externalHref(a);
      if (!url) continue;
      const host = new URL(url).hostname;
      if (seen.has(host)) continue;
      seen.add(host);

      const block = h3.closest('div.g, div.MjjYud, div[data-hveid]') || h3.parentElement;
      const fav = block.querySelector('img[src*="favicon"], img[src^="data:image"], .XNo5Ab, .eqA2re img');
      out.push({
        url,
        host,
        title: h3.textContent.trim(),
        description: descriptionFor(block, h3),
        favicon: fav?.getAttribute('src') || null,
        node: block,
      });
      if (out.length >= 6) break;
    }
    return out;
  };

  /** A featured snippet Google served itself, if any. */
  OG.googleSnippet = function () {
    const block = document.querySelector(
      '.xpdopen .ifM9O, .g-blk, [data-attrid="wa:/description"], .kp-blk .hgKElc, .c2xzTb'
    );
    if (!block) return null;
    const answerNode = block.querySelector('.hgKElc, [data-tts="answers"], .LGOjhe, span') || block;
    const text = answerNode.textContent.replace(/\s+/g, ' ').trim();
    if (text.length < 40) return null;

    const link = Array.from(block.querySelectorAll('a[href]')).map(externalHref).find(Boolean);
    if (!link) return null;
    const host = new URL(link).hostname;
    const source = {
      url: link,
      host,
      title: block.querySelector('h3')?.textContent.trim() ?? host,
      favicon: null,
      origin: 'google',
      node: block.closest('div[data-hveid], .MjjYud, .g') || block,
    };

    // Ordered list snippets.
    const list = block.querySelector('ol, ul');
    const items = list
      ? Array.from(list.querySelectorAll('li')).map((li) => li.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 8)
      : [];
    if (items.length >= 3) return { kind: 'list', heading: '', ordered: list.tagName === 'OL', items, ...source };
    return { kind: 'paragraph', text: text.slice(0, 420), bold: null, ...source };
  };

  /** The result's own index description, quoted as a card. */
  function describe(result) {
    return { kind: 'paragraph', text: result.description, bold: null, url: result.url, host: result.host, title: result.title, favicon: result.favicon, origin: 'description' };
  }

  /* ----------------------------- reranking -------------------------- */

  /* How long to wait for the real answer before showing Google's description
   * as a placeholder. Long enough that a quick answer never causes a visible
   * swap; short enough that a slow page does not leave a blank box. */
  const STOPGAP_DELAY_MS = 700;

  const RERANK_LIMIT = 6;   // passages sent to the model per page
  const QA_MIN = 3;         // below this the model has found no real answer

  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  /**
   * Reorder the paragraph candidates using the local QA model, which answers
   * "does this passage contain the answer to the query" — the thing keyword
   * overlap cannot see. Keyword score and Google's own pick still count; the
   * model is the largest single term but not a dictator.
   *
   * Any failure leaves the keyword order untouched.
   */
  async function rerank(analysis, query) {
    if (!OG.settings.rerank) return;
    const candidates = analysis.paragraphs.slice(0, RERANK_LIMIT);
    if (candidates.length < 2) return;

    const res = await OG.ask({ type: 'og:score', query, passages: candidates.map((c) => c.text) }, 15000);
    if (!res.ok) {
      OG.log('reranker unavailable, keeping keyword order —', res.error);
      return;
    }

    const best = Math.max(...res.scores);
    if (!isFinite(best) || best < QA_MIN) {
      OG.log('model found no confident answer (best', best, '), keeping keyword order');
      return;
    }

    const kwMax = Math.max(1, ...candidates.map((c) => c.score));
    const ranked = candidates
      .map((c, i) => ({
        candidate: c,
        qa: res.scores[i],
        combined:
          clamp01((res.scores[i] + 5) / 30) * 0.6 +
          clamp01(c.score / kwMax) * 0.25 +
          (c.anchored ? 0.35 : 0),
      }))
      .sort((a, b) => b.combined - a.combined);

    OG.log('reranked:', ranked.map((r) => ({ qa: Math.round(r.qa), text: r.candidate.text.slice(0, 40) })));
    analysis.paragraphs = ranked.map((r) => r.candidate).concat(analysis.paragraphs.slice(RERANK_LIMIT));
  }

  function orderCandidates(results) {
    if (!OG.settings.preferWikipedia) return results;
    const isWiki = (r) => /wikipedia\.org$/i.test(r.host);
    return results.filter(isWiki).concat(results.filter((r) => !isWiki(r)));
  }

  async function synthesize(query) {
    const results = orderCandidates(OG.organicResults());
    if (!results.length) return null;

    for (const result of results.slice(0, 3)) {
      const page = await OG.ask({ type: 'og:fetch', url: result.url }, 12000);
      if (!page.ok) {
        OG.log('fetch failed for', result.host, page.error);
        continue;
      }
      // Hand the extractor Google's own description for this result: it is
      // Google's passage pick for this query, and anchoring on it beats any
      // keyword heuristic we can run locally.
      const analysis = OG.analyzePage(page.html, query, page.finalUrl, result.description);
      await rerank(analysis, query);
      const answer = OG.selectAnswer(analysis);
      if (!answer) {
        OG.log('no passage found on', result.host);
        continue;
      }
      OG.log('extracted', answer.kind, 'from', result.host, 'confidence', answer.confidence);
      return { ...answer, title: answer.title || result.title, host: result.host, favicon: result.favicon, origin: 'extracted' };
    }

    // Last resort: quote the top result's own index description.
    return results[0].description.length > 60 ? describe(results[0]) : null;
  }

  /* ----------------------------- rendering -------------------------- */

  function faviconFor(data) {
    if (data.favicon && /^https?:|^data:/.test(data.favicon)) return data.favicon;
    return 'https://www.google.com/s2/favicons?sz=32&domain=' + encodeURIComponent(data.host);
  }

  function breadcrumb(url) {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean).slice(0, 2);
    const tail = parts.length ? ' › ' + parts.map(decodeURIComponent).join(' › ') : '';
    return u.hostname.replace(/^www\./, '') + tail;
  }

  function body(data) {
    switch (data.kind) {
      case 'paragraph': {
        if (!data.bold) return OG.el('div', { class: 'og-fs-answer', text: data.text });
        const { start, end } = data.bold;
        return OG.el('div', { class: 'og-fs-answer' }, [data.text.slice(0, start), OG.el('b', { text: data.text.slice(start, end) }), data.text.slice(end)]);
      }
      case 'list':
        return OG.el(data.ordered ? 'ol' : 'ul', { class: 'og-fs-list' }, data.items.map((item) => OG.el('li', { text: item })));
      case 'table':
        return OG.el('div', { class: 'og-fs-tablewrap' }, [
          OG.el('table', { class: 'og-fs-table' }, data.grid.map((row, i) => OG.el('tr', {}, row.map((cell) => OG.el(i === 0 ? 'th' : 'td', { text: cell }))))),
        ]);
      default:
        throw new Error('unknown snippet kind ' + data.kind);
    }
  }

  const ORIGIN_NOTE = {
    google: 'Featured snippet from the web',
    extracted: 'Featured snippet from the web',
    description: 'Description from the web',
  };

  /* Google's interactive answer tools — the translate boxes, the calculator,
   * the weather card — are the whole answer on their own. 2020 showed nothing
   * above them, and a snippet quoting some translation vendor's landing page
   * on top of the translate widget is worse than nothing. */
  const TOOL_WIDGETS = '#tw-container, #tw-main, #tw-ob, #cwos, #wob_wc';

  /* The source link carries a text fragment, so the browser scrolls to the
   * quoted passage and marks it — what clicking a 2020 snippet did. Long
   * passages become a start,end range on their first and last few words, which
   * survives the page's own line breaks and inline markup. The directive
   * syntax reserves "-", which encodeURIComponent leaves alone. */
  const FRAGMENT_WORDS = 6;
  function fragment(text) {
    const words = text.split(/\s+/).filter(Boolean);
    const encode = (ws) => encodeURIComponent(ws.join(' ')).replace(/-/g, '%2D');
    if (words.length <= FRAGMENT_WORDS * 2) return encode(words);
    return encode(words.slice(0, FRAGMENT_WORDS)) + ',' + encode(words.slice(-FRAGMENT_WORDS));
  }
  function sourceHref(data) {
    const base = data.url.split('#')[0];
    switch (data.kind) {
      case 'paragraph': return base + '#:~:text=' + fragment(data.text);
      case 'list': return base + '#:~:text=' + fragment(data.items[0]).split(',')[0] + ',' + fragment(data.items[data.items.length - 1]).split(',').pop();
      case 'table': return base;
      default: throw new Error('unknown snippet kind ' + data.kind);
    }
  }

  function render(data) {
    const card = OG.el('div', { class: 'og-fs', id: 'og-featured', role: 'complementary' });
    if (data.kind !== 'paragraph' && data.heading) card.appendChild(OG.el('div', { class: 'og-fs-heading', text: data.heading }));
    card.append(
      OG.el('div', { class: 'og-fs-body' }, [body(data)]),
      OG.el('div', { class: 'og-fs-source' }, [
        OG.el('div', { class: 'og-fs-cite-line' }, [
          OG.el('img', { class: 'og-fs-favicon', src: faviconFor(data), alt: '', width: '16', height: '16' }),
          OG.el('cite', { class: 'og-fs-cite', text: breadcrumb(data.url) }),
        ]),
        OG.el('a', { class: 'og-fs-title', href: sourceHref(data), rel: 'noopener', onclick: () => chrome.runtime.sendMessage({ type: 'og:highlight', url: data.url }) }, [
          OG.el('h3', { text: data.title }),
        ]),
      ]),
      OG.el('div', { class: 'og-fs-foot' }, [
        OG.el('span', { class: 'og-fs-note', text: ORIGIN_NOTE[data.origin] }),
        OG.el('span', { class: 'og-fs-badge', title: 'Rendered by Old Google (2020) — one source, quoted verbatim', text: 'old google' }),
      ])
    );
    return card;
  }

  function mount(card) {
    document.getElementById('og-featured')?.remove();
    const column = OG.column();
    if (column) column.insertBefore(card, column.firstChild);
  }

  function show(data) {
    state.data = data;
    mount(render(data));
  }

  /**
   * The real snippet needs a round trip to the source page, which is typically
   * a few hundred ms but can be seconds on a slow site. Rather than showing
   * nothing until then, quote the top result's index description immediately —
   * it needs no network — and swap in the extracted passage when it arrives.
   */
  function provisional() {
    const top = OG.organicResults()[0];
    if (top.description.length < 60) return null;
    // Never show the box at all rather than show scraped page furniture.
    if (top.description.includes('://') || top.description.includes(top.title)) return null;
    return describe(top);
  }

  // Exposed for the demo harness in demo/serp.html.
  OG.renderSnippet = render;
  OG.mountSnippet = mount;

  /* ------------------------------ driver ---------------------------- */

  OG.ensureSnippet = function () {
    const mode = OG.settings.snippetMode;
    // 2020 had featured snippets on the web tab only; Videos, Forums and the
    // rest are lists of one kind of thing, and their column has no gap for it.
    // A dictionary card or the emoji box is the answer instead, the way 2020 did.
    if (mode === 'off' || !OG.isResultsPage() || !OG.isWebTab() || OG.dictionary.status === 'done' || OG.emoji.key) {
      document.getElementById('og-featured')?.remove();
      return;
    }
    // Hold off while the dictionary lookup is in flight so the two never flash over each other.
    if (OG.dictionary.status === 'pending') return;

    const key = OG.query() + '|' + OG.startIndex() + '|' + mode;
    if (state.key !== key) {
      state.key = key;
      state.status = 'idle';
      state.data = null;
      document.getElementById('og-featured')?.remove();
    }

    if (state.status !== 'idle') {
      // Google re-renders the column often; put the card back if it went with it.
      if (state.data && !document.getElementById('og-featured')) mount(render(state.data));
      return;
    }

    // Google's translate boxes, calculator or weather card are the answer.
    if (document.querySelector(TOOL_WIDGETS)) {
      state.status = 'done';
      return;
    }

    // Google's own snippet always wins — it's already the classic thing.
    const native = OG.googleSnippet();
    if (native) {
      native.node.setAttribute('data-og-hidden', 'native-fs');
      state.status = 'done';
      show(native);
      return;
    }

    if (mode !== 'synthesize') {
      state.status = 'done';
      return;
    }

    // Wait until results actually exist before spending a fetch.
    if (!OG.organicResults().length) return;

    state.status = 'pending';

    /* The real answer needs a page fetch and a pass of the model, so it cannot
     * be there instantly. Google's index description can, and showing it kept
     * the box from sitting empty — but when the real answer arrives quickly the
     * reader just sees the text change under them for no reason.
     *
     * So hold the stopgap back. If the real answer beats the delay, it is the
     * only thing ever shown and nothing swaps. The stopgap appears only when
     * waiting would otherwise mean staring at a blank space. */
    const stopgap = provisional();
    const stopgapTimer = setTimeout(() => {
      if (!stopgap || state.key !== key || state.status !== 'pending') return;
      show(stopgap);
      OG.log('still working; showing the index description meanwhile');
    }, STOPGAP_DELAY_MS);

    synthesize(OG.query())
      .catch((err) => {
        OG.log('snippet build failed', err);
        return null;
      })
      .then((data) => {
        clearTimeout(stopgapTimer);
        if (state.key !== key) return;
        state.status = 'done';
        if (data) return show(data);
        // Nothing better was found. Show the stopgap now if it never appeared.
        if (stopgap && state.data !== stopgap) show(stopgap);
        OG.log('no passage extracted; showing the index description');
      });
  };
})();

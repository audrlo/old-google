(() => {
  const OG = window.OG;

  const GOOGLE_HOST = /(^|\.)google(\.[a-z]{2,3}){1,2}$/i;

  const state = { key: null, status: 'idle', data: null }; // status: idle | pending | done

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

  function externalHref(a) {
    const href = a.getAttribute('href');
    if (href.startsWith('#') || href.startsWith('/')) return null;
    const u = new URL(href, location.href);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (GOOGLE_HOST.test(u.hostname)) return null;
    if (/googleadservices|doubleclick|\/aclk/.test(u.href)) return null;
    return u.href;
  }

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

    const list = block.querySelector('ol, ul');
    const items = list
      ? Array.from(list.querySelectorAll('li')).map((li) => li.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 8)
      : [];
    if (items.length >= 3) return { kind: 'list', heading: '', ordered: list.tagName === 'OL', items, ...source };
    return { kind: 'paragraph', text: text.slice(0, 420), bold: null, ...source };
  };

  function describe(result) {
    return { kind: 'paragraph', text: result.description, bold: null, url: result.url, host: result.host, title: result.title, favicon: result.favicon, origin: 'description' };
  }

  const STOPGAP_DELAY_MS = 700;

  const RERANK_LIMIT = 6;   // passages sent to the model per page
  const QA_MIN = 3;         // below this the model has found no real answer

  const clamp01 = (v) => Math.max(0, Math.min(1, v));

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

    return results[0].description.length > 60 ? describe(results[0]) : null;
  }

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

  const TOOL_WIDGETS = '#tw-container, #tw-main, #tw-ob, #cwos, #wob_wc';

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

  function provisional() {
    const top = OG.organicResults()[0];
    if (top.description.length < 60) return null;
    if (top.description.includes('://') || top.description.includes(top.title)) return null;
    return describe(top);
  }

  OG.renderSnippet = render;
  OG.mountSnippet = mount;

  OG.ensureSnippet = function () {
    const mode = OG.settings.snippetMode;
    if (mode === 'off' || !OG.isResultsPage() || !OG.isWebTab() || OG.dictionary.status === 'done' || OG.emoji.key) {
      document.getElementById('og-featured')?.remove();
      return;
    }
    if (OG.dictionary.status === 'pending') return;

    const key = OG.query() + '|' + OG.startIndex() + '|' + mode;
    if (state.key !== key) {
      state.key = key;
      state.status = 'idle';
      state.data = null;
      document.getElementById('og-featured')?.remove();
    }

    if (state.status !== 'idle') {
      if (state.data && !document.getElementById('og-featured')) mount(render(state.data));
      return;
    }

    if (document.querySelector(TOOL_WIDGETS)) {
      state.status = 'done';
      return;
    }

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

    if (!OG.organicResults().length) return;

    state.status = 'pending';

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
        if (stopgap && state.data !== stopgap) show(stopgap);
        OG.log('no passage extracted; showing the index description');
      });
  };
})();

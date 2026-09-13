(() => {
  const OG = window.OG;

  const STOPWORDS = new Set(
    ('a an and are as at be but by for from how if in into is it its of on or that the their there ' +
     'these this to was were what when where which who why will with does do did can could should ' +
     'would you your my me i vs versus').split(' ')
  );

  const BOILERPLATE = /(cookie|subscribe|newsletter|sign in|log in|all rights reserved|privacy policy|terms of (use|service)|advertisement|share this|follow us|скачать)/i;

  const LIST_INTENT = /^(how (to|do|does|can)|steps|ways|tips|what are|list of|best|top \d+|types of|examples of|benefits of|reasons)/i;

  const TABLE_INTENT = /(\bvs\.?\b|\bversus\b|compar(e|ed|ison)|\btable\b|\bchart\b|difference(s)? between|by (year|country|state|month)|\bstats\b|\bspecs\b|dimensions|sizes)/i;

  const STRIP = 'script,style,noscript,template,iframe,svg,canvas,form,button,select,textarea,' +
    'nav,header,footer,aside,figure figcaption,[role="navigation"],[role="banner"],[role="contentinfo"],' +
    '[role="complementary"],[role="search"],[aria-hidden="true"],.nav,.navbar,.menu,.sidebar,.footer,' +
    '.header,.comment,.comments,.advert,.ad,.ads,.cookie,.newsletter,.related,.breadcrumb,.toc,' +
    '#toc,.reference,.mw-editsection,.hatnote,.navbox,.infobox,.thumbcaption,.metadata,.shortdescription,' +
    '.mw-empty-elt,.noprint,.sidebar-content';

  const MAIN_CANDIDATES = [
    '#mw-content-text .mw-parser-output', // Wikipedia
    'main article', 'article', 'main', '[role="main"]',
    '#content', '.post-content', '.entry-content', '.article-body', '.article-content',
    '.content', '#main',
  ];

  function stem(word) {
    let w = word.toLowerCase().replace(/[^a-z0-9'-]/g, '');
    if (w.length <= 3) return w;
    if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
    if (/(sses|shes|ches|xes)$/.test(w)) return w.slice(0, -2);
    if (/ing$/.test(w) && w.length > 5) w = w.slice(0, -3);
    else if (/ed$/.test(w) && w.length > 4) w = w.slice(0, -2);
    if (/s$/.test(w) && !/ss$/.test(w)) w = w.slice(0, -1);
    return w;
  }

  function words(text) {
    return text.toLowerCase().split(/[^a-z0-9'-]+/).filter(Boolean);
  }

  function terms(query) {
    const kept = words(query).filter((w) => w.length > 2 && !STOPWORDS.has(w));
    return Array.from(new Set(kept.map(stem)));
  }

  function clean(text) {
    return text
      .replace(/\[\d+\]/g, '')       // wikipedia citation markers
      .replace(/\[(edit|citation needed)\]/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function coverage(text, ts) {
    if (!ts.length) return 0;
    const stems = new Set(words(text).map(stem));
    return ts.filter((t) => stems.has(t)).length / ts.length;
  }

  function bestSentenceCoverage(text, ts) {
    const parts = text.match(/[^.!?]+[.!?]*/g) || [text];
    let best = 0;
    for (const part of parts) {
      if (part.trim().length < 25) continue;
      best = Math.max(best, coverage(part, ts));
    }
    return best;
  }

  const PREAMBLE = /(in this (article|post|guide|blog)|we(?:'|’)?ll (explore|look|cover|discuss)|keep reading|read on|let(?:'|’)?s (dive|take a look)|table of contents|in this section|before we (get to|dive|begin)|it helps to know|first,? a little)/i;

  function anchorProbe(description) {
    const fragments = description
      .split(/\.\.\.|…|\u00a0/)
      .map((f) => f.replace(/\s+/g, ' ').trim())
      .filter((f) => f.length >= 25);
    if (!fragments.length) return '';
    fragments.sort((a, b) => b.length - a.length);
    return normalizeForMatch(fragments[0]);
  }

  function normalizeForMatch(text) {
    return text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function nearestHeading(node) {
    let cur = node;
    for (let i = 0; i < 30 && cur; i++) {
      let sib = cur.previousElementSibling;
      while (sib) {
        if (/^H[2-6]$/.test(sib.tagName)) return clean(sib.textContent);
        if (sib.tagName === 'H1') return '';
        sib = sib.previousElementSibling;
      }
      cur = cur.parentElement;
    }
    return '';
  }

  function buildDoc(html) {
    const doc = new DOMParser().parseFromString(html.replace(/<base\b[^>]*>/gi, ''), 'text/html');
    for (const node of Array.from(doc.querySelectorAll(STRIP))) node.remove();
    return doc;
  }

  function findRoot(doc) {
    for (const sel of MAIN_CANDIDATES) {
      const node = doc.querySelector(sel);
      if (node && clean(node.textContent).length > 250) return node;
    }
    return doc.body || doc.documentElement;
  }

  function pageTitle(doc) {
    const og = doc.querySelector('meta[property="og:title"]');
    if (og?.content) return clean(og.content);
    return clean(doc.querySelector('h1')?.textContent ?? doc.title);
  }

  function scoreParagraphs(root, ts, query, anchor) {
    const nodes = Array.from(root.querySelectorAll('p, dd, blockquote, li'));
    const scored = [];
    const phrase = query.toLowerCase().trim();
    const probe = anchorProbe(anchor);

    nodes.forEach((node, index) => {
      if (node.tagName === 'LI' && node.closest('nav, .toc, .navbox')) return;
      const text = clean(node.textContent);
      if (text.length < 60 || text.length > 900) return;
      if (BOILERPLATE.test(text)) return;
      if (!/[.!?]/.test(text)) return; // needs to read like prose

      const whole = coverage(text, ts);
      const best = bestSentenceCoverage(text, ts);
      let score = Math.max(whole, best * 1.1) * 100;

      if (phrase.length > 8 && text.toLowerCase().includes(phrase)) score += 45;

      const anchored = !!(probe && normalizeForMatch(text).includes(probe));
      if (anchored) score += 130;

      score -= Math.min(35, Math.abs(text.length - 220) / 12);

      score += Math.max(0, 8 - index * 1.5);

      const heading = nearestHeading(node);
      if (heading) score += coverage(heading, ts) * 45;

      if (PREAMBLE.test(text)) {
        score -= 90;
      } else if (/^[A-Z][^.]{2,60}\s(is|are|was|were|refers to|means|describes)\s/.test(text)) {
        score += 18;
      }

      scored.push({ node, text, score, index, anchored });
    });

    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  function scoreLists(root, ts, query) {
    const lists = Array.from(root.querySelectorAll('ol, ul'));
    const scored = [];
    const wantsList = LIST_INTENT.test(query.trim());

    lists.forEach((list, index) => {
      if (list.closest('nav, .toc, .navbox')) return;
      const items = Array.from(list.children)
        .filter((li) => li.tagName === 'LI')
        .map((li) => clean(li.textContent))
        .filter((t) => t.length > 3 && t.length < 220 && !BOILERPLATE.test(t));
      if (items.length < 3 || items.length > 12) return;
      const avg = items.reduce((s, t) => s + t.length, 0) / items.length;
      if (avg < 18) return;

      let score = coverage(items.join(' '), ts) * 70;
      const heading = nearestHeading(list);
      if (heading) score += coverage(heading, ts) * 45;
      if (wantsList) score += 55;
      if (list.tagName === 'OL' && wantsList) score += 20;
      score += Math.max(0, 15 - index * 3);

      scored.push({
        node: list,
        heading,
        ordered: list.tagName === 'OL',
        items: items.slice(0, 8),
        score,
      });
    });

    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  function scoreTables(root, ts, query) {
    const scored = [];
    const wantsTable = TABLE_INTENT.test(query);
    Array.from(root.querySelectorAll('table')).forEach((table, index) => {
      const rows = Array.from(table.querySelectorAll('tr')).slice(0, 9);
      if (rows.length < 2) return;
      const grid = rows.map((tr) =>
        Array.from(tr.querySelectorAll('th,td')).slice(0, 5).map((c) => clean(c.textContent))
      );
      const cols = grid[0].length;
      if (cols < 2 || cols > 5) return;
      if (grid.some((r) => r.length === 0)) return;
      const flat = grid.flat().join(' ');
      if (flat.length < 40 || flat.length > 1400) return;

      let score = coverage(flat, ts) * 60;
      const caption = table.querySelector('caption');
      const heading = caption ? clean(caption.textContent) : nearestHeading(table);
      if (heading) score += coverage(heading, ts) * (caption ? 70 : 50);
      if (wantsTable) score += 55;
      score += Math.max(0, 10 - index * 4);
      scored.push({ heading, grid, score });
    });
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  function pickBoldRange(text, ts) {
    if (!ts.length) return null;
    const parts = text.match(/[^.!?]+[.!?]*/g) || [text];
    let best = null;
    let offset = 0;
    for (const part of parts) {
      const c = coverage(part, ts);
      if (!best || c > best.c) best = { c, start: offset, end: offset + part.length };
      offset += part.length;
    }
    if (!best || best.c < 0.5) return null;
    if (best.end - best.start > text.length * 0.85) return null;
    return { start: best.start, end: best.end };
  }

  OG.analyzePage = function (html, query, url, anchor) {
    const doc = buildDoc(html);
    const ts = terms(query);
    const root = findRoot(doc);
    return {
      title: pageTitle(doc),
      url,
      ts,
      paragraphs: scoreParagraphs(root, ts, query, anchor),
      lists: scoreLists(root, ts, query),
      tables: scoreTables(root, ts, query),
    };
  };

  OG.selectAnswer = function (analysis) {
    const { paragraphs, lists, tables, title, url, ts } = analysis;
    const [bestP] = paragraphs;
    const [bestL] = lists;
    const [bestT] = tables;
    const pScore = bestP?.score ?? -1;
    const lScore = bestL?.score ?? -1;
    const tScore = bestT?.score ?? -1;

    if (lScore > pScore + 10 && lScore > tScore) {
      return {
        kind: 'list',
        heading: bestL.heading,
        ordered: bestL.ordered,
        items: bestL.items,
        title,
        url,
        confidence: Math.min(1, lScore / 120),
      };
    }
    if (tScore > pScore + 15 && tScore > lScore) {
      return {
        kind: 'table',
        heading: bestT.heading,
        grid: bestT.grid,
        title,
        url,
        confidence: Math.min(1, tScore / 120),
      };
    }
    if (pScore > 25) {
      let text = bestP.text;
      if (text.length > 360) {
        const cut = text.slice(0, 360);
        const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
        text = stop > 140 ? cut.slice(0, stop + 1) : cut.replace(/\s+\S*$/, '') + '…';
      }
      return {
        kind: 'paragraph',
        text,
        bold: pickBoldRange(text, ts),
        title,
        url,
        confidence: Math.min(1, pScore / 120),
      };
    }
    return null;
  };

  OG.extractAnswer = function (html, query, url, anchor) {
    return OG.selectAnswer(OG.analyzePage(html, query, url, anchor));
  };
})();

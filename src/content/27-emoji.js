/* Old Google (2020) — the emoji box.
 *
 * "fire emoji", "shrug emoji copy", "❤️ emoji": the emoji, large, with a Copy
 * button. Google added this box in June 2025 but it only fires for some
 * phrasings and some emoji; this one answers every emoji and every phrasing,
 * and Google's own box is hidden so there is one. The table is Unicode's emoji list
 * with CLDR's English names and keywords (data/emoji.json), served by the
 * service worker; nothing leaves the machine.
 */
(() => {
  const OG = window.OG;

  const MAX_MATCHES = 8;
  const GROUPS = ['Smileys & Emotion', 'People & Body', 'Animals & Nature', 'Food & Drink', 'Travel & Places', 'Activities', 'Objects', 'Symbols', 'Flags', 'Component'];
  // A pictograph with its variation selector, skin tone and ZWJ tail; a flag
  // (two regional indicators); or a keycap.
  const EMOJI_CHAR = /[\u{1F1E6}-\u{1F1FF}]{2}|[#*0-9]️?⃣|\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*/u;
  const SKIN_TONE = /[\u{1F3FB}-\u{1F3FF}]/gu;

  const QUESTION = /^(?:what|what's|how|why|when|where|which|who|is|are|do|does|can|meaning|define)\b/;

  /** @returns {null | {kind: 'char', char: string} | {kind: 'name', term: string}} */
  OG.emojiTarget = function (raw) {
    const q = raw.trim().toLowerCase();
    const char = q.match(EMOJI_CHAR);
    if (char) return { kind: 'char', char: char[0] };
    const m = q.match(/^(?:copy(?: and| &)? paste )?(.+?)\s+emojis?(?:\s+(?:copy|copy(?: and| &)? paste|copy paste|to copy|paste))?$/) || q.match(/^emojis?\s+(?:for|of)\s+(.+)$/);
    if (!m) return null;
    const term = m[1].replace(/^(?:the|a|an)\s+/, '').replace(/\s+(?:copy|paste)$/, '').trim();
    if (!term || QUESTION.test(term)) return null;
    return { kind: 'name', term };
  };

  // Among equals a smiley beats an object ("hundred points" over "euro
  // banknote" for "100"), then the plain form wins: "red heart" over "sparkling heart",
  // "person shrugging" over "man shrugging".
  const plainness = (e) => e.n.length + (/^(?:man|woman|men|women) /i.test(e.n) ? 20 : 0);

  // "laugh" matches "laughing"; short words must match exactly.
  const sameWord = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));

  /** Best matches first: the exact name, a name ending in the term ("red heart"
   *  for "heart"), a keyword, then every query word found somewhere. */
  OG.emojiMatches = function (target, table) {
    switch (target.kind) {
      case 'char': {
        // The table folds skin tones into the base emoji; a toned one you
        // pasted is offered back exactly as typed, with the base beside it.
        const plain = (c) => c.replace(/️/g, '').replace(SKIN_TONE, '');
        const base = table.filter((e) => plain(e.c) === plain(target.char));
        if (!base.length || plain(target.char) === target.char.replace(/️/g, '')) return base;
        return [{ ...base[0], c: target.char }, ...base];
      }
      case 'name': {
        const term = target.term;
        const words = term.split(/\s+/);
        const rank = (e) => {
          const name = e.n.toLowerCase().replace(/[:,]/g, '');
          const nameWords = name.split(' ');
          if (name === term) return 0;
          if (name.endsWith(' ' + term)) return 1;
          if (e.k.includes(term)) return 2;
          if (words.every((w) => nameWords.some((n) => sameWord(n, w)))) return 3;
          if (words.every((w) => nameWords.some((n) => sameWord(n, w)) || e.k.some((k) => k.split(' ').some((n) => sameWord(n, w))))) return 4;
          return 9;
        };
        return table
          .map((e) => ({ e, r: rank(e) }))
          .filter((x) => x.r < 9)
          .sort((a, b) => a.r - b.r || GROUPS.indexOf(a.e.g) - GROUPS.indexOf(b.e.g) || plainness(a.e) - plainness(b.e))
          .slice(0, MAX_MATCHES)
          .map((x) => x.e);
      }
      default:
        throw new Error('emoji: unknown target ' + target.kind);
    }
  };

  /* ------------------------------ rendering -------------------------
   * Google's box (June 2025): a bordered card holding a row of emoji, each
   * over an outlined "Copy" pill with the copy icon; the pill turns into a
   * filled "Copied" with a check for a few seconds. No names, no attribution,
   * just a Feedback link under the card. */

  const COPY_ICON = '<svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
  const CHECK_ICON = '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
  const COPIED_MS = 4000;

  function icon(svg) {
    const span = OG.el('span', { class: 'og-emoji-icon' });
    span.innerHTML = svg; // our own constant markup
    return span;
  }

  function item(e) {
    const button = OG.el('button', { class: 'og-emoji-copy', type: 'button', 'aria-label': 'Copy ' + e.n }, [
      icon(COPY_ICON),
      OG.el('span', { class: 'og-emoji-copy-text', text: 'Copy' }),
    ]);
    button.addEventListener('click', () => {
      navigator.clipboard.writeText(e.c);
      button.replaceChildren(icon(CHECK_ICON), OG.el('span', { class: 'og-emoji-copy-text', text: 'Copied' }));
      button.classList.add('og-emoji-copied');
      setTimeout(() => {
        button.replaceChildren(icon(COPY_ICON), OG.el('span', { class: 'og-emoji-copy-text', text: 'Copy' }));
        button.classList.remove('og-emoji-copied');
      }, COPIED_MS);
    });
    return OG.el('div', { class: 'og-emoji-item', role: 'listitem' }, [
      OG.el('div', { class: 'og-emoji-glyph', title: e.n, text: e.c }),
      button,
    ]);
  }

  function render(matches) {
    return OG.el('div', { class: 'og-emoji', id: 'og-emoji', role: 'complementary' }, [
      OG.el('div', { class: 'og-emoji-card' }, [OG.el('div', { class: 'og-emoji-row', role: 'list' }, matches.map(item))]),
      OG.el('div', { class: 'og-emoji-foot' }, [
        OG.el('a', { class: 'og-emoji-feedback', href: 'https://github.com/audrlo/old-google/issues', rel: 'noopener', text: 'Feedback' }),
      ]),
    ]);
  }

  function mount(box) {
    const rso = document.getElementById('rso') || document.getElementById('center_col');
    if (!rso) return;
    rso.insertBefore(box, rso.firstChild);
  }

  /* ------------------------------ driver ---------------------------- */

  let table = null; // fetched once per page
  const state = { key: null, box: null };
  OG.emojiActive = false; // 30-snippet.js holds the featured snippet back while this is set

  OG.ensureEmoji = function () {
    const target = OG.isResultsPage() && OG.isWebTab() ? OG.emojiTarget(OG.query()) : null;
    const key = target ? JSON.stringify(target) : null;
    for (const node of OG.qsa('#symbolsGenboxContainer')) node.setAttribute('data-og-hidden', 'emoji');
    if (state.key !== key) {
      state.key = key;
      state.box = null;
      const old = document.getElementById('og-emoji');
      if (old) old.remove();
    }
    OG.emojiActive = !!target;
    if (!target) return;
    if (state.box) {
      if (!state.box.isConnected) mount(state.box); // Google re-rendered the column
      return;
    }
    const ready = table ? Promise.resolve(table) : new Promise((resolve) => chrome.runtime.sendMessage({ type: 'og:emojiTable' }, resolve));
    ready.then((t) => {
      table = t;
      if (state.key !== key || state.box) return;
      const matches = OG.emojiMatches(target, table);
      if (!matches.length) return;
      state.box = render(matches);
      mount(state.box);
      OG.log('emoji box for', target, matches[0].c);
    });
  };
})();

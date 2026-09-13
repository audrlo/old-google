(() => {
  const OG = window.OG;

  const MAX_MATCHES = 8;
  const GROUPS = ['Smileys & Emotion', 'People & Body', 'Animals & Nature', 'Food & Drink', 'Travel & Places', 'Activities', 'Objects', 'Symbols', 'Flags', 'Component'];
  const EMOJI_CHAR = /[\u{1F1E6}-\u{1F1FF}]{2}|[#*0-9]️?⃣|\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*/u;
  const SKIN_TONE = /[\u{1F3FB}-\u{1F3FF}]/gu;

  const QUESTION = /^(?:what|what's|how|why|when|where|which|who|is|are|do|does|can|meaning|define)\b/;

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

  const plainness = (e) => e.n.length + (/^(?:man|woman|men|women) |\bcat\b/i.test(e.n) ? 20 : 0);

  const sameWord = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));

  const SAID_AS = { sticking: 'stuck', stick: 'stuck', sticks: 'stuck' };
  const wordsOf = (s) => s.split(/[\s-]+/).filter(Boolean).map((w) => SAID_AS[w] || w);

  OG.emojiMatches = function (target, table) {
    switch (target.kind) {
      case 'char': {
        const plain = (c) => c.replace(/️/g, '').replace(SKIN_TONE, '');
        const base = table.filter((e) => plain(e.c) === plain(target.char));
        if (!base.length || plain(target.char) === target.char.replace(/️/g, '')) return base;
        return [{ ...base[0], c: target.char }, ...base];
      }
      case 'name': {
        const term = target.term;
        const words = wordsOf(term);
        const rank = (e) => {
          const name = e.n.toLowerCase().replace(/[:,]/g, '');
          const nameWords = wordsOf(name);
          if (name === term) return 0;
          if (name.endsWith(' ' + term)) return 1;
          if (e.k.includes(term)) return 2;
          if (words.every((w) => nameWords.some((n) => sameWord(n, w)))) return 3;
          if (words.every((w) => nameWords.some((n) => sameWord(n, w)) || e.k.some((k) => wordsOf(k).some((n) => sameWord(n, w))))) return 4;
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
    const column = OG.column();
    if (!column) return;
    column.insertBefore(box, column.firstChild);
  }

  let table = null; // Promise of the table, fetched once per page
  const state = (OG.emoji = { key: null, box: null });

  OG.ensureEmoji = function () {
    const target = OG.isResultsPage() && OG.isWebTab() ? OG.emojiTarget(OG.query()) : null;
    const key = target ? JSON.stringify(target) : null;
    for (const node of OG.qsa('#symbolsGenboxContainer')) node.setAttribute('data-og-hidden', 'emoji');
    if (state.key !== key) {
      state.key = key;
      state.box = null;
      document.getElementById('og-emoji')?.remove();
    }
    if (!target) return;
    if (state.box) {
      if (!state.box.isConnected) mount(state.box); // Google re-rendered the column
      return;
    }
    table ??= OG.ask({ type: 'og:emojiTable' }, 10000).then((res) => {
      if (!res.ok) throw new Error('emoji table: ' + res.error);
      return res.table;
    });
    table.then((t) => {
      if (state.key !== key || state.box) return;
      const matches = OG.emojiMatches(target, t);
      if (!matches.length) return;
      state.box = render(matches);
      mount(state.box);
      OG.log('emoji box for', target, matches[0].c);
    });
  };
})();

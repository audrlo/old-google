/* Old Google (2020) — the dictionary / thesaurus card.
 *
 * "gazelle definition", "define gazelle", "marvelous synonym" used to open a
 * built-in card: the word, its pronunciation with a speaker button, numbered
 * senses with examples, and rows of "Similar" / "Opposite" chips. Today those
 * queries return an ordinary snippet quoting a dictionary site. This puts the
 * card back and hides Google's own box if one shows up.
 *
 * Google's box quoted Oxford Languages; with Oxford API credentials in the
 * popup this does too. Otherwise definitions and examples come from
 * Wiktionary's REST API and synonyms, antonyms and the pronunciation from
 * Datamuse, both free and keyless. Only the
 * single word is ever sent, and only for queries that clearly ask for a
 * definition — see OG.dictionaryTarget. Wiktionary's HTML is reduced to text
 * before anything touches the page.
 *
 * The look is Google's last pre-AI-Overviews design (late 2023); see dictionary.css.
 */
(() => {
  const OG = window.OG;

  const WIKTIONARY = 'https://en.wiktionary.org/api/rest_v1/page/definition/';
  const DATAMUSE = 'https://api.datamuse.com/words?';
  const OXFORD = {
    production: 'https://od-api.oxforddictionaries.com/api/v2/',
    sandbox: 'https://od-api-sandbox.oxforddictionaries.com/api/v2/',
  };
  const FEEDBACK = 'https://github.com/audrlo/old-google/issues';
  const LEARN_MORE = 'https://github.com/audrlo/old-google#dictionary';
  const WORD = /^[a-z][a-z'’-]{1,23}(?: [a-z'’-]{2,23})?$/i;
  const SHOWN = 2; // senses per part of speech, and parts of speech, before "more definitions"

  const SPEAKER = '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
  const CHEVRON = '<svg viewBox="0 0 24 24"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>';

  function assert(cond, msg) {
    if (!cond) throw new Error('dictionary: ' + msg);
  }

  OG.dictionaryPending = false;
  OG.dictionaryActive = false;

  /**
   * @returns {null | {word: string, mode: 'define'|'synonym', opposite: boolean}}
   * opposite is set for antonym queries, which lead with the opposite words.
   */
  OG.dictionaryTarget = function (raw) {
    const q = (raw || '').trim().toLowerCase().replace(/[?!.]+$/, '');
    if (!q) return null;

    const patterns = [
      [/^(?:define|defn)\s+(.+)$/, 'define'],
      [/^(?:the\s+)?(?:definition|meaning) of\s+(.+)$/, 'define'],
      [/^what (?:does|do)\s+(.+?)\s+mean$/, 'define'],
      [/^what is (?:a |an |the )?(.+?)\s+(?:definition|meaning)$/, 'define'],
      [/^(.+?)\s+(?:definition|meaning|defined|def)$/, 'define'],
      [/^(?:synonyms?|antonyms?)\s+(?:for|of)\s+(.+)$/, 'synonym'],
      [/^(.+?)\s+(?:synonyms?|antonyms?)$/, 'synonym'],
      [/^another word for\s+(.+)$/, 'synonym'],
    ];

    for (const [re, mode] of patterns) {
      const m = q.match(re);
      if (!m) continue;
      const word = m[1].trim().replace(/^(?:a|an|the)\s+/, '');
      if (WORD.test(word)) return { word, mode, opposite: mode === 'synonym' && /\bantonyms?\b/.test(q) };
    }
    return null;
  };

  /* ------------------------------ sources --------------------------- */

  function fetchJson(url, headers) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'og:fetchJson', url, headers }, (res) => {
        if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message });
        resolve(res);
      });
    });
  }

  /** Wiktionary and Oxford hand back HTML; only its text is ever used. */
  function text(html) {
    return new DOMParser().parseFromString(html, 'text/html').body.textContent.replace(/\s+/g, ' ').trim();
  }

  // Every provider resolves to the same shapes, kept per word for the page lifetime:
  //   entry:    {word, phonetic, audio, blocks: [{pos, senses: [{text, example}]}], credit}
  //   similar:  string[]      opposite: string[]
  const cache = new Map();
  function sources(word) {
    if (cache.has(word)) return cache.get(word);
    const s = OG.settings.oxfordAppId && OG.settings.oxfordAppKey ? oxford(word) : free(word);
    cache.set(word, s);
    return s;
  }

  function free(word) {
    const w = encodeURIComponent(word);
    const defs = fetchJson(WIKTIONARY + encodeURIComponent(word.replace(/ /g, '_')), {});
    const meta = fetchJson(DATAMUSE + 'sp=' + w + '&md=dpr&max=1', {});
    const words = (res) => (res.ok ? res.data.map((x) => x.word) : []);
    return {
      entry: Promise.all([defs, meta]).then(([defs, meta]) => shapeFree(word, defs, meta)),
      similar: fetchJson(DATAMUSE + 'rel_syn=' + w + '&max=30', {}).then(words),
      opposite: fetchJson(DATAMUSE + 'rel_ant=' + w + '&max=30', {}).then(words),
    };
  }

  /* Oxford Languages is what Google's own box quoted ("Definitions from Oxford
   * Languages"). Its API is keyed and paid, so it is used only when the popup
   * has credentials. The thesaurus endpoint carries synonyms and antonyms. */
  function oxford(word) {
    const base = OXFORD[OG.settings.oxfordSandbox ? 'sandbox' : 'production'];
    const headers = { app_id: OG.settings.oxfordAppId, app_key: OG.settings.oxfordAppKey };
    const w = encodeURIComponent(word.toLowerCase());
    const entries = fetchJson(base + 'entries/en-us/' + w + '?fields=definitions,examples,pronunciations&strictMatch=false', headers);
    const thesaurus = fetchJson(base + 'thesaurus/en/' + w + '?fields=synonyms,antonyms&strictMatch=false', headers);
    const words = (field) => (res) => {
      if (!res.ok) return [];
      const out = [];
      for (const sense of oxfordSenses(res.data)) for (const x of sense[field] || []) if (!out.includes(x.text)) out.push(x.text);
      return out;
    };
    return { entry: entries.then((res) => shapeOxford(word, res)), similar: thesaurus.then(words('synonyms')), opposite: thesaurus.then(words('antonyms')) };
  }

  // results[].lexicalEntries[].entries[].senses[] — flattened, with the part of speech stapled on.
  function oxfordSenses(data) {
    assert(Array.isArray(data.results) && data.results.length, 'Oxford: no results');
    return data.results.flatMap((r) => r.lexicalEntries.flatMap((le) => le.entries.flatMap((e) =>
      (e.senses || []).map((sense) => ({ ...sense, pos: le.lexicalCategory.text.toLowerCase(), pronunciations: e.pronunciations || [] })))));
  }

  function shapeOxford(word, res) {
    assert(res.ok, 'Oxford: ' + res.error);
    const senses = oxfordSenses(res.data).filter((s) => s.definitions);
    assert(senses.length, 'Oxford: no definitions for ' + word);
    const blocks = [];
    for (const s of senses) {
      let block = blocks.find((b) => b.pos === s.pos);
      if (!block) blocks.push((block = { pos: s.pos, senses: [] }));
      block.senses.push({ text: text(s.definitions[0]), example: s.examples ? text(s.examples[0].text) : '' });
    }
    const pron = senses.flatMap((s) => s.pronunciations).find((p) => p.phoneticSpelling);
    return {
      word,
      phonetic: pron ? '/' + pron.phoneticSpelling + '/' : '',
      audio: pron && pron.audioFile ? pron.audioFile : '',
      blocks,
      credit: 'Definitions from Oxford Languages',
    };
  }

  // -> [{pos, senses: [{text, example}]}]
  function blocksFromWiktionary(data) {
    assert(Array.isArray(data.en), 'no English entry');
    const blocks = data.en.map((e) => ({
      pos: e.partOfSpeech.toLowerCase(),
      senses: e.definitions
        .map((d) => ({ text: text(d.definition), example: d.examples ? text(d.examples[0]) : '' }))
        .filter((s) => s.text),
    }));
    return blocks.filter((b) => b.senses.length);
  }

  // Datamuse's fallback definitions look like "adj\tExciting wonder or surprise."
  const POS = { n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb', u: '' };
  function blocksFromDatamuse(hit) {
    const blocks = [];
    for (const def of hit.defs) {
      const [tag, body] = def.split('\t');
      assert(tag in POS, 'unknown part of speech ' + tag);
      let block = blocks.find((b) => b.pos === POS[tag]);
      if (!block) blocks.push((block = { pos: POS[tag], senses: [] }));
      block.senses.push({ text: body.trim(), example: '' });
    }
    return blocks;
  }

  const IPA = {
    AA: 'ɑ', AE: 'æ', AH0: 'ə', AH: 'ʌ', AO: 'ɔ', AW: 'aʊ', AY: 'aɪ', EH: 'ɛ', ER: 'ər', EY: 'eɪ', IH: 'ɪ', IY: 'i',
    OW: 'oʊ', OY: 'ɔɪ', UH: 'ʊ', UW: 'u', CH: 'tʃ', DH: 'ð', HH: 'h', JH: 'dʒ', NG: 'ŋ', SH: 'ʃ', TH: 'θ', ZH: 'ʒ', Y: 'j',
  };
  const STRESS = { 0: '', 1: 'ˈ', 2: 'ˌ' };

  /** "HH AE1 P IY0" -> "/ˈhæpi/". A stress mark goes before the consonants leading
   *  into the vowel; of two or more, the first stays with the syllable before. */
  function respell(arpabet) {
    let out = '';
    let consonants = [];
    for (const token of arpabet.trim().split(/\s+/)) {
      const phone = token.replace(/\d$/, '');
      const ipa = IPA[token] || IPA[phone] || phone.toLowerCase();
      if (phone === token) {
        consonants.push(ipa);
        continue;
      }
      const coda = consonants.length > 1 ? consonants.shift() : '';
      out += coda + STRESS[token.slice(-1)] + consonants.join('') + ipa;
      consonants = [];
    }
    return '/' + out + consonants.join('') + '/';
  }
  OG.respell = respell; // for the tests

  function shapeFree(word, defs, meta) {
    const hit = meta.ok && meta.data.length ? meta.data[0] : null; // Datamuse knows most words, not all
    const blocks = defs.ok ? blocksFromWiktionary(defs.data) : hit && hit.defs ? blocksFromDatamuse(hit) : [];
    assert(blocks.length, 'no definitions for ' + word);
    const pron = hit && hit.tags ? hit.tags.find((t) => t.startsWith('pron:')) : null;
    return {
      word,
      phonetic: pron ? respell(pron.slice(5)) : '',
      audio: '',
      blocks,
      credit: defs.ok ? 'Definitions from Wiktionary · Synonyms from Datamuse' : 'Definitions and synonyms from Datamuse',
    };
  }

  /* ---------------------------- rendering --------------------------- */

  function icon(svg) {
    const span = OG.el('span');
    span.innerHTML = svg; // our own constant markup, never API data
    return span;
  }

  function defineUrl(word) {
    return '/search?q=define+' + encodeURIComponent(word);
  }

  function chip(word) {
    return OG.el('a', { class: 'og-dict-chip', href: defineUrl(word), text: word });
  }

  // The chips arrive after the card is up, so a row starts out as just its
  // label; the CSS reserves the collapsed height so nothing jumps.
  const LABEL = { similar: 'Similar', opposite: 'Opposite' };
  function chipRow(kind, mode) {
    const label = OG.el('span', { class: 'og-dict-label', text: LABEL[kind] + (mode === 'define' ? ':' : '') });
    const chips = OG.el('div', { class: 'og-dict-chips' });
    if (mode === 'define') chips.appendChild(label); // inline with the chips
    return OG.el('div', { class: 'og-dict-row og-dict-' + kind }, mode === 'define' ? [chips] : [label, chips]);
  }

  function fill(row, words) {
    if (!words.length) return row.remove();
    const chips = row.querySelector('.og-dict-chips');
    for (const w of words) chips.appendChild(chip(w));
    chips.classList.add('og-dict-filled');
    clamp(chips);
  }

  /* Collapsed, a chip list shows one row (thesaurus: two); max-height hides the
     rest. A caret pill takes the place of the last chip that fits, and clicking
     it opens the list. Measures offsetTop, so the card must be in the page. */
  function clamp(chips) {
    if (!chips.isConnected || chips.querySelector('.og-dict-caret')) return;
    const limit = chips.clientHeight;
    const overflows = (el) => el.offsetTop + el.offsetHeight > limit;
    const first = Array.from(chips.querySelectorAll('.og-dict-chip')).find(overflows);
    if (!first) return;
    const caret = OG.el('a', {
      class: 'og-dict-chip og-dict-caret',
      href: '#',
      'aria-label': 'Show more',
      onclick: (e) => {
        e.preventDefault();
        chips.classList.toggle('og-dict-open');
      },
    }, icon(CHEVRON));
    chips.insertBefore(caret, first);
    while (overflows(caret) && caret.previousElementSibling.classList.contains('og-dict-chip')) {
      chips.insertBefore(caret, caret.previousElementSibling);
    }
  }

  // Google numbered senses only when there were several.
  function senses(block) {
    const list = OG.el('ol', { class: block.senses.length === 1 ? 'og-dict-senses og-dict-single' : 'og-dict-senses' });
    block.senses.forEach((s, i) => {
      const li = OG.el('li', { class: i < SHOWN ? '' : 'og-dict-extra' }, OG.el('div', { class: 'og-dict-def', text: s.text }));
      if (s.example) li.appendChild(OG.el('div', { class: 'og-dict-example', text: '"' + s.example + '"' }));
      list.appendChild(li);
    });
    return list;
  }

  // "Definitions from Oxford Languages · Learn more", under the heading.
  function credit(entry) {
    return OG.el('div', { class: 'og-dict-credit' }, [
      OG.el('span', { text: entry.credit }),
      ' · ',
      OG.el('a', { href: LEARN_MORE, rel: 'noopener', text: 'Learn more' }),
    ]);
  }

  // A rule with the pill sitting on it, then Feedback.
  function foot(panel, more) {
    const label = OG.el('span', { text: more });
    const pill = OG.el('a', { class: 'og-dict-more', href: '#', onclick: (e) => {
      e.preventDefault();
      const open = panel.classList.toggle('og-dict-expanded');
      label.textContent = open ? 'Show less' : more;
    } }, [label, icon(CHEVRON)]);
    return OG.el('div', { class: 'og-dict-foot' }, [
      OG.el('div', { class: 'og-dict-rule' }, pill),
      OG.el('a', { class: 'og-dict-feedback', href: FEEDBACK, rel: 'noopener', text: 'Feedback' }),
    ]);
  }

  function render(target, entry) {
    const panel = OG.el('div', { class: 'og-dict og-dict-' + target.mode, id: 'og-dictionary' });
    const word = OG.el('div', { class: 'og-dict-word', text: entry.word });

    switch (target.mode) {
      case 'define': {
        const speak = OG.el('button', { class: 'og-dict-speak', type: 'button', 'aria-label': 'Listen', onclick: () => {
          if (entry.audio) return new Audio(entry.audio).play();
          const u = new SpeechSynthesisUtterance(entry.word);
          u.lang = 'en-US';
          speechSynthesis.speak(u);
        } }, icon(SPEAKER));
        panel.append(
          OG.el('div', { class: 'og-dict-heading', text: 'Dictionary' }),
          credit(entry),
          OG.el('div', { class: 'og-dict-head' }, [speak, OG.el('div', {}, [word, OG.el('div', { class: 'og-dict-pron', text: entry.phonetic })])])
        );
        entry.blocks.forEach((block, i) => {
          const el = OG.el('div', { class: i < SHOWN ? 'og-dict-block' : 'og-dict-block og-dict-extra' }, [
            OG.el('div', { class: 'og-dict-pos', text: block.pos }),
            senses(block),
          ]);
          if (i === 0) el.append(chipRow('similar', 'define'), chipRow('opposite', 'define'));
          panel.appendChild(el);
        });
        panel.appendChild(foot(panel, 'More definitions'));
        return panel;
      }
      case 'synonym': {
        const first = entry.blocks[0];
        const rows = [chipRow('similar', 'synonym'), chipRow('opposite', 'synonym')];
        if (target.opposite) rows.reverse();
        panel.append(
          OG.el('div', { class: 'og-dict-heading', text: 'Similar and opposite words' }),
          credit(entry),
          word,
          OG.el('div', { class: 'og-dict-pos', text: first.pos }),
          OG.el('div', { class: 'og-dict-def', text: first.senses[0].text }),
          ...rows,
          foot(panel, 'More similar and opposite words')
        );
        return panel;
      }
      default:
        throw new Error('dictionary: unknown mode ' + target.mode);
    }
  }
  OG.renderDictionary = render; // for the tests

  function mount(panel) {
    const rso = document.getElementById('rso') || document.getElementById('center_col');
    if (!rso) return;
    rso.insertBefore(panel, rso.firstChild); // where the featured snippet would go
    for (const chips of panel.querySelectorAll('.og-dict-chips')) clamp(chips);
  }

  /** Google's own dictionary box is replaced by ours, so it is hidden while ours is on its way or showing. */
  function hideGoogleBox(hide) {
    for (const node of OG.qsa('[data-attrid="DictionaryHeader"], #dictionary-modules')) {
      const block = node.closest('#rso > *') || node;
      if (hide) block.setAttribute('data-og-hidden', 'dict');
      else if (block.getAttribute('data-og-hidden') === 'dict') block.removeAttribute('data-og-hidden');
    }
  }

  /* ------------------------------ driver ---------------------------- */

  const state = { key: null, status: 'idle', panel: null }; // status: idle | pending | done | failed

  OG.ensureDictionary = function () {
    const target = OG.settings.dictionary && OG.isResultsPage() && OG.isWebTab() ? OG.dictionaryTarget(OG.query()) : null;
    const key = target ? target.word + '|' + target.mode + '|' + target.opposite : null;

    if (state.key !== key) {
      state.key = key;
      state.status = 'idle';
      state.panel = null;
      OG.dictionaryActive = false;
      OG.dictionaryPending = !!target;
      const old = document.getElementById('og-dictionary');
      if (old) old.remove();
    }
    hideGoogleBox(!!target && state.status !== 'failed');
    if (!target) return;

    if (state.status === 'done') {
      // Google re-rendered the results column out from under us.
      if (!state.panel.isConnected) mount(state.panel);
      return;
    }
    if (state.status !== 'idle') return;

    state.status = 'pending';
    const s = sources(target.word);
    s.entry
      .then((entry) => {
        if (state.key !== key) return;
        const panel = render(target, entry);
        state.status = 'done';
        state.panel = panel;
        OG.dictionaryPending = false;
        OG.dictionaryActive = true;
        mount(panel);
        // 2020 showed the card instead of a snippet for these queries.
        const card = document.getElementById('og-featured');
        if (card) card.remove();
        for (const kind of ['similar', 'opposite']) {
          s[kind].then((words) => fill(panel.querySelector('.og-dict-' + kind), words));
        }
        OG.log('dictionary card for', target.word, target.mode);
      })
      .catch((err) => {
        if (state.key !== key) return;
        state.status = 'failed';
        OG.dictionaryPending = false;
        hideGoogleBox(false);
        OG.log('no dictionary card for', target.word, err.message);
      });
  };
})();

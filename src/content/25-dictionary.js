/* Old Google (2020) — the dictionary / thesaurus panel.
 *
 * "gazelle definition", "define gazelle", "synonyms for gazelle" used to open a
 * built-in panel: the word, its pronunciation, part of speech, numbered senses
 * with examples, and similar words. Today those queries return an ordinary
 * featured snippet quoting a dictionary site's citation line. This puts the
 * panel back.
 *
 * Definitions come from dictionaryapi.dev (Wiktionary data, free, no key). Only
 * the single word is ever sent, and only for queries that clearly ask for a
 * definition — see OG.dictionaryTarget.
 */
(() => {
  const OG = window.OG;

  const ENDPOINT = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
  const WORD = /^[a-z][a-z'’-]{1,23}(?: [a-z'’-]{2,23})?$/i;

  const state = { key: null, status: 'idle', data: null };
  OG.dictionaryPending = false;
  OG.dictionaryActive = false;

  /**
   * @returns {null | {word: string, mode: 'define'|'synonym'}}
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
      if (WORD.test(word)) return { word, mode };
    }
    return null;
  };

  /* ----------------------------- shaping ---------------------------- */

  /** Fold the API's entries into what the 2020 panel actually showed. */
  function shape(entries, word) {
    if (!Array.isArray(entries) || !entries.length) return null;

    let phonetic = '';
    const blocks = [];
    const seenPos = new Set();

    for (const entry of entries) {
      if (!phonetic) {
        phonetic =
          entry.phonetic ||
          (Array.isArray(entry.phonetics) && (entry.phonetics.find((p) => p && p.text) || {}).text) ||
          '';
      }
      for (const meaning of entry.meanings || []) {
        const pos = (meaning.partOfSpeech || '').trim();
        if (!pos || seenPos.has(pos)) continue;

        const senses = [];
        for (const d of meaning.definitions || []) {
          const text = (d.definition || '').trim();
          if (!text) continue;
          senses.push({
            text,
            example: (d.example || '').trim(),
            synonyms: (d.synonyms || []).slice(0, 6),
          });
          if (senses.length >= 3) break;
        }
        if (!senses.length) continue;

        seenPos.add(pos);
        blocks.push({
          pos,
          senses,
          synonyms: (meaning.synonyms || []).slice(0, 8),
          antonyms: (meaning.antonyms || []).slice(0, 6),
        });
        if (blocks.length >= 3) break;
      }
      if (blocks.length >= 3) break;
    }

    if (!blocks.length) return null;
    const source = (entries.find((e) => e.sourceUrls && e.sourceUrls.length) || {}).sourceUrls;
    return {
      word: entries[0].word || word,
      phonetic,
      blocks,
      sourceUrl: source ? source[0] : 'https://en.wiktionary.org/wiki/' + encodeURIComponent(word),
    };
  }

  /* ---------------------------- rendering --------------------------- */

  function renderSynonyms(label, words) {
    if (!words || !words.length) return null;
    const row = OG.el('div', { class: 'og-dict-syn' });
    row.appendChild(OG.el('span', { class: 'og-dict-syn-label', text: label }));
    words.forEach((w, i) => {
      if (i) row.appendChild(document.createTextNode(' · '));
      row.appendChild(OG.el('span', { class: 'og-dict-syn-word', text: w }));
    });
    return row;
  }

  function render(data, mode) {
    const panel = OG.el('div', { class: 'og-dict', id: 'og-dictionary' });

    const head = OG.el('div', { class: 'og-dict-head' }, [
      OG.el('span', { class: 'og-dict-word', text: data.word }),
    ]);
    if (data.phonetic) head.appendChild(OG.el('span', { class: 'og-dict-phonetic', text: data.phonetic }));
    panel.appendChild(head);
    panel.appendChild(OG.el('div', { class: 'og-dict-rule' }));

    for (const block of data.blocks) {
      panel.appendChild(OG.el('div', { class: 'og-dict-pos', text: block.pos }));

      // A thesaurus query leads with the similar words, the way 2020 did.
      if (mode === 'synonym' && block.synonyms.length) {
        panel.appendChild(renderSynonyms('similar:', block.synonyms));
      }

      const list = OG.el('ol', { class: 'og-dict-senses' });
      for (const sense of block.senses) {
        const li = OG.el('li', {}, [OG.el('div', { class: 'og-dict-def', text: sense.text })]);
        if (sense.example) {
          li.appendChild(OG.el('div', { class: 'og-dict-example', text: '"' + sense.example + '"' }));
        }
        const syn = renderSynonyms('similar:', mode === 'synonym' ? [] : sense.synonyms);
        if (syn) li.appendChild(syn);
        list.appendChild(li);
      }
      panel.appendChild(list);

      if (mode === 'synonym' && block.antonyms.length) {
        panel.appendChild(renderSynonyms('opposite:', block.antonyms));
      }
    }

    panel.appendChild(
      OG.el('div', { class: 'og-dict-foot' }, [
        OG.el('span', { text: 'Definitions from Wiktionary' }),
        OG.el('a', { class: 'og-dict-src', href: data.sourceUrl, rel: 'noopener', text: 'More' }),
      ])
    );
    return panel;
  }

  function mount(panel) {
    const old = document.getElementById('og-dictionary');
    if (old) old.remove();
    const rso = document.getElementById('rso') || document.getElementById('center_col');
    if (!rso) return false;
    rso.insertBefore(panel, rso.firstChild); // above the featured snippet
    return true;
  }

  OG.renderDictionary = render; // for the demo harness

  /* ------------------------------ driver ---------------------------- */

  function lookup(word) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (v) => {
        if (!settled) {
          settled = true;
          resolve(v);
        }
      };
      try {
        chrome.runtime.sendMessage({ type: 'og:fetchJson', url: ENDPOINT + encodeURIComponent(word) }, (res) => {
          if (chrome.runtime.lastError) return done({ ok: false, error: chrome.runtime.lastError.message });
          done(res || { ok: false, error: 'empty' });
        });
      } catch (err) {
        done({ ok: false, error: String(err) });
      }
      setTimeout(() => done({ ok: false, error: 'timeout' }), 12000);
    });
  }

  OG.ensureDictionary = function () {
    if (!OG.settings.dictionary || !OG.isResultsPage() || !OG.isWebTab()) {
      const old = document.getElementById('og-dictionary');
      if (old) old.remove();
      OG.dictionaryPending = false;
      OG.dictionaryActive = false;
      return;
    }

    const target = OG.dictionaryTarget(OG.query());
    const key = target ? target.word + '|' + target.mode : null;

    if (state.key !== key) {
      state.key = key;
      state.status = 'idle';
      state.data = null;
      OG.dictionaryActive = false;
      OG.dictionaryPending = !!target;
      const old = document.getElementById('og-dictionary');
      if (old) old.remove();
    }
    if (!target) return;

    if (state.status === 'done') {
      const node = document.getElementById('og-dictionary');
      if ((!node || !node.isConnected) && state.data) mount(render(state.data, target.mode));
      return;
    }
    if (state.status === 'pending') return;

    state.status = 'pending';
    const forKey = key;
    lookup(target.word).then((res) => {
      if (state.key !== forKey) return;
      state.status = 'done';
      OG.dictionaryPending = false;
      if (!res || !res.ok) {
        OG.log('dictionary lookup failed for', target.word, res && res.error);
        return;
      }
      const data = shape(res.data, target.word);
      if (!data) {
        OG.log('dictionary returned nothing usable for', target.word);
        return;
      }
      state.data = data;
      OG.dictionaryActive = true;
      mount(render(data, target.mode));
      // 2020 showed the panel instead of a snippet for these queries.
      const card = document.getElementById('og-featured');
      if (card) card.remove();
      OG.log('dictionary panel for', target.word, target.mode);
    });
  };
})();

/* Old Google (2020) — orchestrator. */
(() => {
  const OG = window.OG;

  let running = false;

  function pass() {
    if (running) return;
    running = true;
    try {
      if (OG.settings.hideAI) OG.purgeAI();
      if (OG.settings.theme) OG.theme();
      OG.ensureDictionary();
      OG.ensureEmoji();
      OG.ensureSnippet();
      if (OG.settings.theme) OG.buildPagination();
    } catch (err) {
      OG.log('pass failed', err);
    } finally {
      // Let our own mutations settle before the observer can re-trigger.
      setTimeout(() => {
        running = false;
      }, 0);
    }
  }

  const schedule = OG.throttle(pass, 200);

  function watchUrl() {
    let last = location.href;
    setInterval(() => {
      if (location.href !== last) {
        last = location.href;
        OG.applyClasses();
        schedule();
      }
    }, 400);
    window.addEventListener('popstate', schedule);
  }

  async function boot() {
    await OG.loadSettings();
    OG.applyClasses();
    OG.applyUserCss();

    if (!OG.isSearchPage()) return;

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', schedule, { once: true });
    }
    schedule();
    window.addEventListener('load', schedule);

    new MutationObserver((records) => {
      // Ignore mutations we caused ourselves.
      for (const r of records) {
        const target = r.target;
        if (target && target.nodeType === 1 && target.closest && target.closest('[data-og]')) continue;
        return schedule();
      }
    }).observe(document.documentElement, { childList: true, subtree: true });

    watchUrl();

    chrome.storage.onChanged.addListener((changes) => {
      let touched = false;
      for (const key in changes) {
        if (key in OG.DEFAULTS) {
          OG.settings[key] = changes[key].newValue;
          touched = true;
        }
      }
      if (!touched) return;
      OG.applyClasses();
      OG.applyUserCss();
      const stale = document.getElementById('og-featured');
      if (stale) stale.remove();
      const pager = document.getElementById('og-pager-wrap');
      if (pager && !OG.settings.pagination) pager.remove();
      schedule();
    });
  }

  boot();
})();

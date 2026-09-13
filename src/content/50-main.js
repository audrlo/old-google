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
      setTimeout(() => {
        running = false;
      }, 0);
    }
  }

  const schedule = OG.throttle(pass, 200);

  function watchUrl() {
    let last = location.href;
    setInterval(() => {
      if (location.href === last) return;
      last = location.href;
      OG.applyClasses();
      schedule();
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
      if (records.some((r) => !r.target.closest('[data-og]'))) schedule();
    }).observe(document.documentElement, { childList: true, subtree: true });

    watchUrl();

    chrome.storage.onChanged.addListener((changes) => {
      const keys = Object.keys(changes).filter((key) => key in OG.DEFAULTS);
      if (!keys.length) return;
      for (const key of keys) OG.settings[key] = changes[key].newValue;
      OG.applyClasses();
      OG.applyUserCss();
      document.getElementById('og-featured')?.remove();
      if (!OG.settings.pagination) document.getElementById('og-pager-wrap')?.remove();
      schedule();
    });
  }

  boot();
})();

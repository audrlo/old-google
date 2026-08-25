const { chromium } = require('playwright');
const path = require('path');
const url = 'file://' + path.join(__dirname, '..', 'demo', 'serp.html');

(async () => {
  const b = await chromium.launch();
  for (const w of [1440, 1280, 1150, 1024]) {
    const p = await b.newPage({ viewport: { width: w, height: 900 } });
    await p.goto(url);
    await p.waitForTimeout(400);
    const r = await p.evaluate(() => {
      const box = (id) => {
        const n = document.getElementById(id);
        if (!n || !n.checkVisibility()) return null;
        const b = n.getBoundingClientRect();
        return { left: Math.round(b.left), width: Math.round(b.width), top: Math.round(b.top) };
      };
      return {
        center_col: box('center_col'),
        rhs: box('rhs'),
        featured: box('og-featured'),
        fsBorder: getComputedStyle(document.getElementById('og-featured')).borderTopWidth,
      };
    });
    console.log(String(w).padStart(4) + 'px  col=' + JSON.stringify(r.center_col) +
      '\n        rhs=' + JSON.stringify(r.rhs) +
      '\n        featured=' + JSON.stringify(r.featured) + ' border=' + r.fsBorder);
    await p.close();
  }
  await b.close();
})();

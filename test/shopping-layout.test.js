/* Commerce-heavy All pages may give #rso grid/flex geometry and put linked
 * product h3s beside organic results. Neither may collapse the web column or
 * turn a product card into the source for the synthesized featured snippet.
 */
const { chromium } = require('playwright');
const path = require('path');

const url = 'file://' + path.join(__dirname, '..', 'demo', 'serp.html');
let pass = 0, fail = 0;

function check(name, condition, detail) {
  if (condition) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n         ' + JSON.stringify(detail)); }
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url);
  await page.waitForSelector('#og-featured');

  const result = await page.evaluate(() => {
    const rso = document.getElementById('rso');
    for (const [i, tab] of Array.from(document.querySelectorAll('#hdtb-msb a')).entries()) {
      tab.href = '/search?q=desk&tab=' + i;
    }
    const sidebar = document.createElement('div');
    sidebar.style.cssText = 'position:absolute;left:28px;top:210px;display:flex;flex-direction:column;gap:14px';
    sidebar.innerHTML = [
      '<a href="/search?q=desk&price=60">Under $60</a>',
      '<a href="/search?q=desk&price=100">$60–$100</a>',
      '<a href="/search?q=desk&price=200">$100–$200</a>',
    ].join('');
    document.body.appendChild(sidebar);

    rso.style.display = 'grid';
    rso.style.gridTemplateColumns = 'repeat(80, minmax(0, 1fr))';

    const product = document.createElement('div');
    product.className = 'MjjYud';
    product.dataset.hveid = 'shopping-product';
    product.innerHTML = '<a href="https://shop.example/desk"><h3>Oak writing desk</h3></a><span>$249</span>';
    rso.insertBefore(product, rso.firstChild);
    window.OG.theme();

    const card = document.getElementById('og-featured').getBoundingClientRect();
    return {
      rsoDisplay: getComputedStyle(rso).display,
      gutter: getComputedStyle(document.documentElement).getPropertyValue('--og-gutter').trim(),
      columnLeft: Math.round(document.getElementById('center_col').getBoundingClientRect().left),
      card: { width: Math.round(card.width), height: Math.round(card.height) },
      productMarked: product.classList.contains('og-result') || !!product.querySelector('.og-title'),
      productHarvested: window.OG.organicResults().some((item) => item.host === 'shop.example'),
    };
  });

  check('results remain a vertical block', result.rsoDisplay === 'block', result);
  check('refinement links do not replace the tab-strip gutter', result.gutter === '180px' && result.columnLeft === 180, result);
  check('featured card keeps the 652px web-column width', result.card.width === 652, result.card);
  check('featured card does not become abnormally tall', result.card.height < 500, result.card);
  check('shopping heading is not styled as an organic result', !result.productMarked, result);
  check('shopping product is not harvested as a BERT source', !result.productHarvested, result);

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();

const DEFAULTS = {
  theme: true,
  hideAI: true,
  hideAds: true,
  followDark: true,
  pagination: true,
  hideFooter: true,
  dictionary: true,
  oxfordAppId: '',
  oxfordAppKey: '',
  oxfordSandbox: false,
  rerank: true,
  greenUrls: false,
  snippetMode: 'synthesize',
  preferWikipedia: false,
  extraHideSelectors: '',
  customCss: '',
  debug: false,
};

const CHECKBOXES = ['theme', 'hideAI', 'hideAds', 'followDark', 'pagination', 'hideFooter', 'greenUrls', 'debug', 'preferWikipedia', 'dictionary', 'rerank', 'oxfordSandbox'];
const TEXTAREAS = ['extraHideSelectors', 'customCss', 'oxfordAppId', 'oxfordAppKey'];

let statusTimer = null;
function flash(msg) {
  const node = document.getElementById('status');
  node.textContent = msg;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    node.textContent = '';
  }, 1400);
}

function paint(settings) {
  for (const key of CHECKBOXES) document.getElementById(key).checked = settings[key];
  for (const key of TEXTAREAS) document.getElementById(key).value = settings[key];
  document.querySelector(`input[name="snippetMode"][value="${settings.snippetMode}"]`).checked = true;
  syncDisabled(settings);
}

function syncDisabled(settings) {
  for (const key of ['followDark', 'greenUrls', 'pagination']) {
    const input = document.getElementById(key);
    input.disabled = !settings.theme;
    input.closest('.row').style.opacity = settings.theme ? '1' : '0.45';
  }
  const wiki = document.getElementById('preferWikipedia');
  const synth = settings.snippetMode === 'synthesize';
  wiki.disabled = !synth;
  wiki.closest('.row').style.opacity = synth ? '1' : '0.45';
}

async function save(patch) {
  await chrome.storage.sync.set(patch);
  syncDisabled(await chrome.storage.sync.get(DEFAULTS));
  flash('Saved');
}

async function init() {
  paint(await chrome.storage.sync.get(DEFAULTS));

  for (const key of CHECKBOXES) {
    document.getElementById(key).addEventListener('change', (e) => save({ [key]: e.target.checked }));
  }
  for (const key of TEXTAREAS) {
    let timer = null;
    document.getElementById(key).addEventListener('input', (e) => {
      clearTimeout(timer);
      const value = e.target.value;
      timer = setTimeout(() => save({ [key]: value }), 400);
    });
  }
  for (const radio of document.querySelectorAll('input[name="snippetMode"]')) {
    radio.addEventListener('change', (e) => {
      if (e.target.checked) save({ snippetMode: e.target.value });
    });
  }
  document.getElementById('reset').addEventListener('click', async () => {
    await chrome.storage.sync.set(DEFAULTS);
    paint(DEFAULTS);
    flash('Reset');
  });
}

init();

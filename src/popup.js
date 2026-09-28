const $ = (id) => document.getElementById(id);
const D = UB.DEFAULT_SETTINGS;
let settings = { ...D };
let host = null;

function fillCurrencies() {
  $('currency').innerHTML = Object.entries(UB.CURRENCIES)
    .map(([code, name]) => `<option value="${code}">${code} — ${name}</option>`)
    .join('');
}

function ago(ts) {
  if (!ts) return 'using bundled rates';
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 60) return `rates ${mins}m old`;
  const hrs = Math.round(mins / 60);
  return hrs < 48 ? `rates ${hrs}h old` : `rates ${Math.round(hrs / 24)}d old`;
}

function save(patch) {
  settings = { ...settings, ...patch };
  chrome.storage.sync.set({ settings });
}

function siteOff() {
  return host ? (settings.disabledHosts || []).includes(host) : false;
}

async function init() {
  fillCurrencies();
  const { settings: stored } = await chrome.storage.sync.get('settings');
  settings = { ...D, ...(stored || {}) };

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    host = new URL(tab.url).hostname.replace(/^www\./, '');
    $('site-label').textContent = `Off on ${host}`;
  } catch {
    $('site-off').disabled = true;
    $('site-label').textContent = 'Not available here';
  }

  $('enabled').checked = settings.enabled;
  $('length').value = settings.length;
  $('currency').value = settings.currency;
  $('site-off').checked = siteOff();

  const { rates } = await chrome.storage.local.get('rates');
  $('rates').textContent = ago(rates && rates.fetchedAt);

  $('enabled').onchange = (e) => save({ enabled: e.target.checked });
  $('length').onchange = (e) => save({ length: e.target.value });
  $('currency').onchange = (e) => save({ currency: e.target.value });
  $('site-off').onchange = (e) => {
    const list = new Set(settings.disabledHosts || []);
    e.target.checked ? list.add(host) : list.delete(host);
    save({ disabledHosts: [...list] });
  };
  $('settings').onclick = (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  };
  $('refresh').onclick = async () => {
    $('refresh').disabled = true;
    $('rates').textContent = 'refreshing…';
    const entry = await chrome.runtime.sendMessage({ type: 'refreshRates' });
    $('rates').textContent = ago(entry && entry.fetchedAt);
    $('refresh').disabled = false;
  };
}

init();

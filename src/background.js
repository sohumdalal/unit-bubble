// Fetches USD-based rates once every 12h, caches them in storage.local, and
// answers the content script. Nothing else lives here.
importScripts('lib/currencies.js');

const ENDPOINT = 'https://open.er-api.com/v6/latest/USD';
const TTL_MS = 12 * 60 * 60 * 1000;
const KEY = 'rates';

async function cached() {
  const { [KEY]: entry } = await chrome.storage.local.get(KEY);
  return entry && entry.rates ? entry : null;
}

async function refresh(force = false) {
  const entry = await cached();
  if (!force && entry && Date.now() - entry.fetchedAt < TTL_MS) return entry;
  try {
    const res = await fetch(ENDPOINT, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json || !json.rates || !json.rates.EUR) throw new Error('unexpected payload');
    const next = {
      rates: json.rates,
      fetchedAt: Date.now(),
      source: 'open.er-api.com',
      base: json.base_code || 'USD',
    };
    await chrome.storage.local.set({ [KEY]: next });
    return next;
  } catch (err) {
    console.warn('[Unit Bubble] rate refresh failed:', err.message);
    if (entry) return entry;
    const seeded = { rates: self.UB.FALLBACK_RATES, fetchedAt: 0, source: 'bundled fallback', base: 'USD' };
    await chrome.storage.local.set({ [KEY]: seeded });
    return seeded;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('refresh-rates', { periodInMinutes: 60 * 6 });
  refresh(true);
});
chrome.runtime.onStartup.addListener(() => refresh());
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'refresh-rates') refresh();
});

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg && msg.type === 'getRates') {
    refresh().then((entry) => respond(entry || { rates: self.UB.FALLBACK_RATES, fetchedAt: 0 }));
    return true;
  }
  if (msg && msg.type === 'openOptions') {
    chrome.runtime.openOptionsPage();
    return false;
  }
  if (msg && msg.type === 'refreshRates') {
    refresh(true).then(respond);
    return true;
  }
  return false;
});

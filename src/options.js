const $ = (id) => document.getElementById(id);
const D = UB.DEFAULT_SETTINGS;
let settings = { ...D };
let rates = { ...UB.FALLBACK_RATES };

const FIELDS = ['length', 'currency', 'dollarMeans', 'yenMeans', 'kronaMeans'];
const ROLES = ['chest', 'shoulders', 'waist', 'hips'];
const unitWord = () => (settings.length === 'in' ? 'inches' : 'centimeters');

function showMeasurements() {
  $('unit-word').textContent = unitWord();
  for (const role of ROLES) {
    const cm = (settings.measurementsCm || {})[role];
    $(`m-${role}`).value = cm ? UB.format.num(settings.length === 'in' ? cm / 2.54 : Number(cm), 1) : '';
  }
}

function currencyOptions(codes) {
  return codes.map((c) => `<option value="${c}">${c} — ${UB.CURRENCIES[c]}</option>`).join('');
}

function fillSelects() {
  $('currency').innerHTML = currencyOptions(Object.keys(UB.CURRENCIES));
  $('dollarMeans').innerHTML = currencyOptions(UB.AMBIGUOUS['$'].options);
  $('yenMeans').innerHTML = currencyOptions(UB.AMBIGUOUS['¥'].options);
  $('kronaMeans').innerHTML = currencyOptions(UB.AMBIGUOUS.kr.options);
}

function preview() {
  const sample = settings.length === 'in' ? '63.5 cm' : '25 in';
  const lenMatch = UB.detect.findMatches(sample, settings)[0];
  const lenConv = lenMatch && UB.convert(lenMatch, settings, rates);
  $('pv-len').textContent = lenConv ? `${sample} → ${lenConv.primary}` : sample;

  const from = settings.currency === 'EUR' ? 'USD' : 'EUR';
  const moneyMatch = { kind: 'money', code: from, value: 49.99 };
  const moneyConv = UB.convert(moneyMatch, settings, rates);
  $('pv-cur').textContent = moneyConv
    ? `${UB.format.money(49.99, from)} → ${moneyConv.primary}`
    : UB.format.money(49.99, from);
}

let savedTimer;
function flashSaved() {
  $('saved').classList.add('on');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => $('saved').classList.remove('on'), 1200);
}

function save(patch) {
  settings = { ...settings, ...patch };
  chrome.storage.sync.set({ settings }, flashSaved);
  preview();
}

// Accepts "56", "56cm", '22"', "1m82" — a bare number means whichever unit the
// user reads in. Always stored as cm.
function parseMeasurement(raw) {
  const text = String(raw).trim();
  if (!text) return '';
  const bare = /^\d+(?:[.,]\d+)?$/.test(text);
  const probe = bare ? `${text} ${settings.length === 'in' ? 'in' : 'cm'}` : text;
  const match = UB.detect.findMatches(probe, settings)[0];
  if (!match || match.kind !== 'length') return null;
  return Math.round((match.mm / 10) * 10) / 10;
}

function saveMeasurement(role, raw) {
  const cm = parseMeasurement(raw);
  const input = document.getElementById(`m-${role}`);
  if (cm === null) {
    input.value = '';
    return;
  }
  save({ measurementsCm: { ...(settings.measurementsCm || {}), [role]: cm } });
  input.value = cm ? UB.format.num(settings.length === 'in' ? cm / 2.54 : cm, 1) : '';
}

function rateStatus(entry) {
  if (!entry || !entry.fetchedAt) return 'Using the bundled fallback table — no live fetch yet.';
  const hrs = (Date.now() - entry.fetchedAt) / 3600000;
  const when = hrs < 1 ? 'just now' : hrs < 48 ? `${Math.round(hrs)}h ago` : `${Math.round(hrs / 24)}d ago`;
  return `Updated ${when} from ${entry.source}.`;
}

async function init() {
  fillSelects();
  const { settings: stored } = await chrome.storage.sync.get('settings');
  settings = { ...D, ...(stored || {}) };

  const { rates: entry } = await chrome.storage.local.get('rates');
  if (entry && entry.rates) rates = entry.rates;
  $('rate-status').textContent = rateStatus(entry);

  for (const id of FIELDS) {
    $(id).value = settings[id];
    $(id).onchange = (e) => {
      save({ [id]: e.target.value });
      if (id === 'length') showMeasurements();
    };
  }
  for (const id of ['underline', 'enabled']) {
    $(id).checked = !!settings[id];
    $(id).onchange = (e) => save({ [id]: e.target.checked });
  }
  showMeasurements();
  for (const role of ROLES) $(`m-${role}`).onchange = (e) => saveMeasurement(role, e.target.value);

  $('disabledHosts').value = (settings.disabledHosts || []).join('\n');
  $('disabledHosts').onchange = (e) =>
    save({
      disabledHosts: e.target.value
        .split('\n')
        .map((s) => s.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''))
        .filter(Boolean),
    });

  $('refresh').onclick = async () => {
    $('refresh').disabled = true;
    $('rate-status').textContent = 'Refreshing…';
    const next = await chrome.runtime.sendMessage({ type: 'refreshRates' });
    if (next && next.rates) rates = next.rates;
    $('rate-status').textContent = rateStatus(next);
    $('refresh').disabled = false;
    preview();
  };

  preview();
}

init();

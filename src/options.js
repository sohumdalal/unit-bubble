const $ = (id) => document.getElementById(id);
const D = UB.DEFAULT_SETTINGS;

let settings = { ...D };
let rates = { ...UB.FALLBACK_RATES };

const SELECTS = ['length', 'currency', 'dollarMeans', 'yenMeans', 'kronaMeans'];
const TOGGLES = ['enabled', 'chipPrices', 'chipMeasurements', 'underline', 'chartAuto', 'chartHighlight'];
const SAMPLE_RATE_CURRENCIES = ['EUR', 'GBP', 'JPY', 'SEK', 'CHF', 'CAD'];

const unitWord = () => (settings.length === 'in' ? 'inches' : 'centimeters');
const currencyOptions = (codes) =>
  codes.map((c) => `<option value="${c}">${c} — ${UB.CURRENCIES[c]}</option>`).join('');

/* ---------- saving ---------- */

let savedTimer;
function save(patch) {
  settings = { ...settings, ...patch };
  chrome.storage.sync.set({ settings }, () => {
    $('saved').classList.add('on');
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => $('saved').classList.remove('on'), 1200);
  });
}

/* ---------- measurements ---------- */

function buildProfiles() {
  $('profiles').innerHTML = UB.fit.PROFILES.map(
    (p) => `
      <div class="card">
        <div class="toggle">
          <strong style="font-weight:500">${p.label}</strong>
          <span class="muted" id="sum-${p.id}"></span>
        </div>
        <div class="fields">
          ${p.fields
            .map(
              (role) => `
            <label class="field">
              <span class="lbl">${UB.fit.FIELDS[role].label}</span>
              <input type="text" inputmode="decimal" data-profile="${p.id}" data-role="${role}"
                     placeholder="${UB.fit.FIELDS[role].hint}" />
            </label>`
            )
            .join('')}
        </div>
      </div>`
  ).join('');

  for (const input of $('profiles').querySelectorAll('input')) {
    input.onchange = (e) => saveMeasurement(e.target.dataset.profile, e.target.dataset.role, e.target.value);
  }
}

function showMeasurements() {
  $('unit-word').textContent = unitWord();
  const inches = settings.length === 'in';
  for (const input of document.querySelectorAll('#profiles input')) {
    const stored = (settings.profiles || {})[input.dataset.profile] || {};
    const cm = Number(stored[input.dataset.role]);
    input.value = cm > 0 ? UB.format.num(inches ? cm / 2.54 : cm, 1) : '';
  }
  for (const p of UB.fit.PROFILES) {
    const filled = Object.values((settings.profiles || {})[p.id] || {}).filter((v) => Number(v) > 0).length;
    $(`sum-${p.id}`).textContent = filled ? `${filled} of ${p.fields.length} set` : 'not set';
  }
}

// Accepts "22", "56cm", '22"', "21 1/2", "1m82" — a bare number means whichever
// unit you read in. Always stored as cm.
function parseMeasurement(raw) {
  const text = String(raw).trim();
  if (!text) return '';
  const bare = /^\d+(?:[.,]\d+)?$|^\d+\s+\d+\/\d+$|^\d+\/\d+$/.test(text);
  const probe = bare ? `${text} ${settings.length === 'in' ? 'in' : 'cm'}` : text;
  const match = UB.detect.findMatches(probe, settings)[0];
  if (!match || match.kind !== 'length') return null;
  return Math.round(match.mm) / 10;
}

function saveMeasurement(profileId, role, raw) {
  const cm = parseMeasurement(raw);
  if (cm === null) return showMeasurements(); // unparseable: put the stored value back
  const profiles = { ...(settings.profiles || {}) };
  profiles[profileId] = { ...(profiles[profileId] || {}), [role]: cm };
  save({ profiles });
  showMeasurements();
}

// One-time move from the flat pre-profile measurements.
function migrate() {
  const old = settings.measurementsCm;
  if (!old) return;
  const used = Object.values(settings.profiles || {}).some((p) => Object.keys(p || {}).length);
  if (used) return;
  const profiles = { tops: {}, jackets: {}, pants: {} };
  let moved = false;
  for (const [role, cm] of Object.entries(old)) {
    if (!Number(cm)) continue;
    moved = true;
    if (role === 'waist' || role === 'hips') profiles.pants[role] = Number(cm);
    else {
      profiles.tops[role] = Number(cm);
      profiles.jackets[role] = Number(cm);
    }
  }
  if (moved) save({ profiles });
}

/* ---------- sites ---------- */

function showHosts() {
  const hosts = settings.disabledHosts || [];
  $('hosts').innerHTML = hosts.length
    ? hosts
        .map(
          (h) =>
            `<span class="host">${h}<button data-host="${h}" title="Remove" aria-label="Remove ${h}">×</button></span>`
        )
        .join('')
    : '<span class="muted">Running everywhere.</span>';
  for (const button of $('hosts').querySelectorAll('button')) {
    button.onclick = () => save({ disabledHosts: hosts.filter((h) => h !== button.dataset.host) });
  }
}

function addHost() {
  const clean = $('addhost')
    .value.trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
  if (!clean) return;
  const next = [...new Set([...(settings.disabledHosts || []), clean])];
  $('addhost').value = '';
  save({ disabledHosts: next });
  showHosts();
}

/* ---------- rates ---------- */

function rateStatus(entry) {
  if (!entry || !entry.fetchedAt) return 'Using the bundled fallback table — no live fetch yet.';
  const hrs = (Date.now() - entry.fetchedAt) / 3600000;
  const when = hrs < 1 ? 'just now' : hrs < 48 ? `${Math.round(hrs)}h ago` : `${Math.round(hrs / 24)}d ago`;
  return `Updated ${when} from ${entry.source}.`;
}

function showRates() {
  const to = settings.currency;
  const rows = SAMPLE_RATE_CURRENCIES.filter((c) => c !== to && rates[c] && rates[to]);
  $('rate-list').innerHTML = rows
    .map((from) => {
      const rate = rates[to] / rates[from];
      return `<div>1 ${from} = <strong>${UB.format.num(rate, rate < 1 ? 4 : rate < 100 ? 3 : 2)}</strong> ${to}</div>`;
    })
    .join('');
}

/* ---------- boot ---------- */

async function init() {
  $('currency').innerHTML = currencyOptions(Object.keys(UB.CURRENCIES));
  $('dollarMeans').innerHTML = currencyOptions(UB.AMBIGUOUS['$'].options);
  $('yenMeans').innerHTML = currencyOptions(UB.AMBIGUOUS['¥'].options);
  $('kronaMeans').innerHTML = currencyOptions(UB.AMBIGUOUS.kr.options);
  $('version').textContent = `v${chrome.runtime.getManifest().version}`;

  const { settings: stored } = await chrome.storage.sync.get('settings');
  settings = { ...D, ...(stored || {}) };

  const { rates: entry } = await chrome.storage.local.get('rates');
  if (entry && entry.rates) rates = entry.rates;
  $('rate-status').textContent = rateStatus(entry);

  for (const id of SELECTS) {
    $(id).value = settings[id];
    $(id).onchange = (e) => {
      save({ [id]: e.target.value });
      if (id === 'length') showMeasurements();
      if (id === 'currency') showRates();
    };
  }
  for (const id of TOGGLES) {
    $(id).checked = !!settings[id];
    $(id).onchange = (e) => save({ [id]: e.target.checked });
  }

  buildProfiles();
  migrate();
  showMeasurements();
  showHosts();
  showRates();

  $('addhost-go').onclick = addHost;
  $('addhost').onkeydown = (e) => {
    if (e.key === 'Enter') addHost();
  };

  $('refresh').onclick = async () => {
    $('refresh').disabled = true;
    $('rate-status').textContent = 'Refreshing…';
    const next = await chrome.runtime.sendMessage({ type: 'refreshRates' });
    if (next && next.rates) rates = next.rates;
    $('rate-status').textContent = rateStatus(next);
    $('refresh').disabled = false;
    showRates();
  };

  $('reset').onclick = () => {
    if (!confirm('Put every setting back to its default? Your measurements are cleared too.')) return;
    settings = { ...D };
    chrome.storage.sync.set({ settings }, () => location.reload());
  };
}

init();

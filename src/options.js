const $ = (id) => document.getElementById(id);
const D = UB.DEFAULT_SETTINGS;
let settings = { ...D };
let rates = { ...UB.FALLBACK_RATES };

const FIELDS = ['length', 'currency', 'dollarMeans', 'yenMeans', 'kronaMeans'];
const unitWord = () => (settings.length === 'in' ? 'inches' : 'centimeters');

// One card per garment type, fields from src/lib/fit.js.
function buildProfiles() {
  const host = $('profiles');
  host.innerHTML = UB.fit.PROFILES.map(
    (p) => `
      <div class="card" style="margin-top:12px">
        <div class="row between">
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

  for (const input of host.querySelectorAll('input')) {
    input.onchange = (e) => saveMeasurement(e.target.dataset.profile, e.target.dataset.role, e.target.value);
  }
}

function showMeasurements() {
  $('unit-word').textContent = unitWord();
  const inches = settings.length === 'in';
  for (const input of document.querySelectorAll('#profiles input')) {
    const cm = Number((settings.profiles || {})[input.dataset.profile]?.[input.dataset.role]);
    input.value = cm > 0 ? UB.format.num(inches ? cm / 2.54 : cm, 1) : '';
  }
  for (const p of UB.fit.PROFILES) {
    const filled = Object.values((settings.profiles || {})[p.id] || {}).filter((v) => Number(v) > 0).length;
    $(`sum-${p.id}`).textContent = filled ? `${filled} of ${p.fields.length} set` : 'not set';
  }
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
  if (!old || settings.profiles === undefined) return;
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
  buildProfiles();
  migrate();
  showMeasurements();

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

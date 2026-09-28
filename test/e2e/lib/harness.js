// Launches Chromium with the extension loaded, serves the mock stores, and
// gives each case a page plus helpers for reading our own UI.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { serve } = require('./server.js');
const watchScript = require('./watch.js');

const ROOT = path.join(__dirname, '..', '..', '..');
const SITES = path.join(__dirname, '..', 'sites');

// Everything about our own UI, read out of the page in one call.
function readUi() {
  const host = [...document.querySelectorAll('[data-ub-root]')].find((h) => h.shadowRoot && h.shadowRoot.querySelector('.wrap'));
  const wrap = host && host.shadowRoot.querySelector('.wrap');
  const rows = wrap ? [...wrap.querySelectorAll('tbody tr')].map((tr) => [...tr.cells].map((td) => td.textContent.trim())) : [];
  const chip = (el) => ({
    original: el.previousSibling && el.previousSibling.nodeValue ? el.previousSibling.nodeValue.trim() : null,
    text: el.textContent,
  });
  return {
    chips: [...document.querySelectorAll('.ub-chip')].map(chip),
    chipCount: document.querySelectorAll('.ub-chip').length,
    hits: [...document.querySelectorAll('.ub-hit')].map((h) => ({
      match: h.dataset.ub || '',
      chip: h.querySelector('.ub-chip') ? h.querySelector('.ub-chip').textContent : null,
      original: h.firstChild && h.firstChild.nodeType === 3 ? h.firstChild.nodeValue : null,
      inChart: !!h.closest('[data-ub-chart]'),
      inBadPlace: !!h.closest('input,textarea,[contenteditable=""],[contenteditable="true"]') || !!h.ownerSVGElement,
    })),
    cta: document.querySelectorAll('.ub-cta').length,
    ctaVisible: [...document.querySelectorAll('.ub-cta')].some((c) => c.getBoundingClientRect().height > 0),
    ctaText: (document.querySelector('.ub-cta') || {}).textContent || null,
    charts: document.querySelectorAll('[data-ub-chart]').length,
    panel: !!wrap,
    panelWidth: wrap ? Math.round(wrap.getBoundingClientRect().width) : 0,
    panelHeight: wrap ? Math.round(wrap.getBoundingClientRect().height) : 0,
    panelScrolls: wrap
      ? (() => {
          const body = wrap.querySelector('.body');
          return !!body && body.scrollHeight - body.clientHeight > 2;
        })()
      : false,
    title: wrap ? wrap.querySelector('h2').textContent.replace(/\s+/g, ' ').trim() : null,
    toggles: wrap ? [...wrap.querySelectorAll('.seg button')].map((b) => ({ label: b.textContent, on: b.getAttribute('aria-pressed') === 'true' })) : [],
    headers: wrap ? [...wrap.querySelectorAll('thead th')].map((th) => th.textContent.trim()) : [],
    rows,
    pickedRow: wrap && wrap.querySelector('tr.pick td') ? wrap.querySelector('tr.pick td').textContent.trim() : null,
    foot: wrap && wrap.querySelector('.foot span') ? wrap.querySelector('.foot span').textContent.replace(/\s+/g, ' ').trim() : null,
    events: window.__ub ? window.__ub.events : [],
    panelWraps: window.__ub ? window.__ub.panelWraps : 0,
  };
}

async function open() {
  const { server, port } = await serve(SITES);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ub-e2e-'));
  const context = await chromium.launchPersistentContext(profile, {
    headless: !process.env.HEADED,
    channel: process.env.HEADED ? undefined : 'chromium',
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
    viewport: { width: 1440, height: 900 },
  });
  await context.addInitScript(watchScript);

  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20000 });

  return {
    context,
    port,
    async settings(patch) {
      await worker.evaluate(async (settings) => chrome.storage.sync.set({ settings }), patch);
    },
    // Fixed rates, so a price assertion is exact rather than dependent on what
    // the live endpoint says today.
    async rates(table) {
      await worker.evaluate(
        async (rates) => chrome.storage.local.set({ rates: { rates, fetchedAt: Date.now(), source: 'e2e', base: 'USD' } }),
        table
      );
    },
    async page(file, { settle = 1200 } = {}) {
      const page = await context.newPage();
      const errors = [];
      // Every page error, whatever it mentions. A name filter is how the
      // TypeError that broke the unit toggle stayed hidden for three rounds.
      page.on('pageerror', (err) => errors.push(String(err.stack || err).split('\n').slice(0, 2).join(' | ')));
      const logs = [];
      page.on('console', (msg) => {
        logs.push(`${msg.type()}: ${msg.text()}`);
        if (msg.type() !== 'error') return;
        // A mock store has no favicon; that is not our bug.
        if (/Failed to load resource/.test(msg.text())) return;
        errors.push(`console: ${msg.text()}`);
      });
      await page.goto(`http://127.0.0.1:${port}/${file}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(settle);
      page.__errors = errors;
      page.__logs = logs;
      return page;
    },
    async close() {
      await context.close();
      server.close();
    },
  };
}

// Interaction helpers, all driven through the page so they exercise real
// listeners rather than calling into the extension.
const ui = (page) => page.evaluate(readUi);

const clickCta = async (page, wait = 700) => {
  const clicked = await page.evaluate(() => {
    const cta = document.querySelector('.ub-cta');
    if (!cta) return false;
    cta.click();
    return true;
  });
  await page.waitForTimeout(wait);
  return clicked;
};

const clickToggle = async (page, label, wait = 400) => {
  const clicked = await page.evaluate((want) => {
    const host = [...document.querySelectorAll('[data-ub-root]')].find((h) => h.shadowRoot && h.shadowRoot.querySelector('.seg'));
    if (!host) return false;
    const button = [...host.shadowRoot.querySelectorAll('.seg button')].find((b) => b.textContent.trim() === want);
    if (!button) return false;
    button.click();
    return true;
  }, label);
  await page.waitForTimeout(wait);
  return clicked;
};

const dismissPanel = async (page, wait = 400) => {
  await page.evaluate(() => {
    const host = [...document.querySelectorAll('[data-ub-root]')].find((h) => h.shadowRoot && h.shadowRoot.querySelector('.x'));
    if (host) host.shadowRoot.querySelector('.x').click();
  });
  await page.waitForTimeout(wait);
};

const hoverCell = async (page, row, col, wait = 250) => {
  await page.evaluate(
    ({ row, col }) => {
      const host = [...document.querySelectorAll('[data-ub-root]')].find((h) => h.shadowRoot && h.shadowRoot.querySelector('.wrap'));
      const tr = host && host.shadowRoot.querySelectorAll('tbody tr')[row];
      const td = tr && tr.cells[col];
      if (td) td.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    },
    { row, col }
  );
  await page.waitForTimeout(wait);
  return page.evaluate(() => {
    const host = [...document.querySelectorAll('[data-ub-root]')].find((h) => h.shadowRoot && h.shadowRoot.querySelector('.tip'));
    const tip = host && host.shadowRoot.querySelector('.tip');
    return tip ? { text: tip.textContent.replace(/\s+/g, ' ').trim(), tone: tip.dataset.tone || null } : null;
  });
};

const watchPanel = (page) => page.evaluate(() => window.__ubWatchPanel && window.__ubWatchPanel());

module.exports = { open, ui, clickCta, clickToggle, dismissPanel, hoverCell, watchPanel };

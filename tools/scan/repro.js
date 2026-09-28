#!/usr/bin/env node
// Drives one page through the interactions that keep breaking, and prints what
// actually happened at each step. Guessing at these from a screenshot has been
// wrong twice.
//
//   node tools/scan/repro.js [--url ...] [--headed] [--length in] [--currency USD]
require('../../src/lib/currencies.js');

const path = require('path');
const fs = require('fs');
const args = require('./lib/args.js')();
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const URL = args.url || 'https://brut-clothing.com/products/the-best-pocket-t-shirt-heather-grey';
const SETTINGS = {
  ...UB.DEFAULT_SETTINGS,
  debug: true,
  length: args.length || 'in',
  currency: args.currency || 'USD',
  profiles: { tops: { chest: 57 }, jackets: {}, pants: {} },
};

// Everything about our own UI, read out of the page in one go.
function state() {
  const host = document.querySelector('[data-ub-root]');
  const root = host && host.shadowRoot;
  const wrap = root && root.querySelector('.wrap');
  const cells = wrap ? [...wrap.querySelectorAll('tbody tr')].map((tr) => [...tr.cells].map((td) => td.textContent)) : [];
  return {
    cta: !!document.querySelector('.ub-cta'),
    ctaText: (document.querySelector('.ub-cta') || {}).textContent || null,
    ctaVisible: document.querySelector('.ub-cta')
      ? document.querySelector('.ub-cta').getBoundingClientRect().height > 0
      : false,
    host: !!host,
    popoverOpen: !!(host && host.matches && host.matches(':popover-open')),
    panel: !!wrap,
    title: wrap ? wrap.querySelector('h2').textContent.replace(/\s+/g, ' ').trim() : null,
    toggles: wrap ? [...wrap.querySelectorAll('.seg button')].map((b) => `${b.textContent}${b.getAttribute('aria-pressed') === 'true' ? '*' : ''}`) : [],
    firstRow: cells[0] || null,
    rows: cells.length,
    chartMarked: document.querySelectorAll('[data-ub-chart]').length,
    chips: document.querySelectorAll('.ub-chip').length,
    loaded: !!window.__ubLoaded,
    url: location.href,
    docTitle: document.title.slice(0, 60),
    triggerLabels: [...document.querySelectorAll('a,button,summary,[role="button"]')]
      .map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim())
      .filter((t) => t && t.length <= 40 && /size|guide|chart|fit|taille/i.test(t))
      .slice(0, 8),
  };
}

const show = (label, s) =>
  console.log(
    `${label.padEnd(26)} chips=${String(s.chips).padStart(3)} cta=${s.cta ? (s.ctaVisible ? 'yes' : 'hidden') : 'no'} ` +
      `panel=${s.panel ? 'open' : 'closed'} popover=${s.popoverOpen} chart=${s.chartMarked} ` +
      `toggles=[${s.toggles.join(' ')}] row1=${s.firstRow ? JSON.stringify(s.firstRow) : '-'}`
  );

async function main() {
  const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ub-repro-'));
  const context = await chromium.launchPersistentContext(profile, {
    headless: !args.headed,
    channel: args.headed ? undefined : 'chromium',
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
    viewport: { width: 1440, height: 900 },
  });
  let worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  await worker.evaluate(async (s) => chrome.storage.sync.set({ settings: s }), SETTINGS);

  const page = await context.newPage();
  page.on('console', (m) => {
    if (/unit bubble/i.test(m.text())) console.log(`   ${m.text().slice(0, 1400)}`);
  });
  page.on('pageerror', (e) => console.log(`   pageerror ${String(e.stack || e).split('\n').slice(0, 2).join(' | ').slice(0, 260)}`));

  console.log(`\n${URL}\nreading in ${SETTINGS.length} / ${SETTINGS.currency}\n`);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(4000);
  const first = await page.evaluate(state);
  console.log(`   page: ${first.docTitle}\n   url:  ${first.url}\n   content script loaded: ${first.loaded}`);
  console.log(`   size-ish controls: ${JSON.stringify(first.triggerLabels)}`);
  show('after load', first);

  // 1. open the store's own size guide
  const opened = await page.evaluate(() => {
    const el = [...document.querySelectorAll('a,button,summary,[role="button"]')].find((e) =>
      /^\s*size\s*(guide|chart)\s*$/i.test((e.textContent || '').replace(/[^\p{L}\p{N}&\s]+/gu, ' ').trim())
    );
    if (!el) return null;
    el.click();
    return el.tagName + '.' + String(el.className).slice(0, 30);
  });
  console.log(`   clicked store trigger: ${opened || 'NOT FOUND'}`);
  await page.waitForTimeout(2500);
  show('store guide open', await page.evaluate(state));

  // 2. click our own CTA
  const clickCta = async (label) => {
    const hit = await page.evaluate(() => {
      const cta = document.querySelector('.ub-cta');
      if (!cta) return false;
      cta.click();
      return true;
    });
    await page.waitForTimeout(1200);
    show(label + (hit ? '' : ' (no cta!)'), await page.evaluate(state));
  };
  await clickCta('after Open Chart');

  // 3. the unit toggle
  for (const which of [0, 1, 0]) {
    const label = await page.evaluate((i) => {
      const root = document.querySelector('[data-ub-root]');
      const buttons = root && root.shadowRoot ? [...root.shadowRoot.querySelectorAll('.seg button')] : [];
      if (!buttons[i]) return null;
      buttons[i].click();
      return buttons[i].textContent;
    }, which);
    await page.waitForTimeout(700);
    show(`toggle "${label}"`, await page.evaluate(state));
  }

  // 4. dismiss, then reopen with the button
  await page.evaluate(() => {
    const root = document.querySelector('[data-ub-root]');
    const x = root && root.shadowRoot && root.shadowRoot.querySelector('.x');
    if (x) x.click();
  });
  await page.waitForTimeout(800);
  show('after dismiss', await page.evaluate(state));
  await clickCta('reopen via Open Chart');
  await clickCta('reopen again');

  if (args.headed) await page.waitForTimeout(20000);
  await context.close();
}

main();

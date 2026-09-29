#!/usr/bin/env node
// Store-listing screenshots, captured through the same harness that runs the
// tests — so what the listing shows is the extension actually working, not a
// mockup. Writes 1280x800 PNGs to store/screenshots.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { serve } = require('../../test/e2e/lib/server.js');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'store', 'screenshots');
const SIZE = { width: 1280, height: 800 };

const SETTINGS = {
  enabled: true,
  length: 'in',
  currency: 'USD',
  dollarMeans: 'USD',
  yenMeans: 'JPY',
  kronaMeans: 'SEK',
  underline: false,
  chipPrices: true,
  chipMeasurements: true,
  chartAuto: false,
  chartHighlight: true,
  disabledHosts: [],
  profiles: { tops: { chest: 57, shoulders: 46 }, jackets: {}, pants: {} },
};
const RATES = { USD: 1, EUR: 0.92, GBP: 0.79, SEK: 10.5, CHF: 0.9, JPY: 151, CAD: 1.36 };

const clickCta = (page) =>
  page.evaluate(() => {
    const cta = document.querySelector('.ub-cta');
    if (cta) cta.click();
    return !!cta;
  });

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { server, port } = await serve(path.join(ROOT, 'test', 'e2e', 'sites'));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ub-shots-'));
  const context = await chromium.launchPersistentContext(profile, {
    headless: !process.env.HEADED,
    channel: process.env.HEADED ? undefined : 'chromium',
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
    viewport: SIZE,
  });

  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20000 });
  const id = new URL(worker.url()).host;
  await worker.evaluate(async (s) => chrome.storage.sync.set({ settings: s }), SETTINGS);
  await worker.evaluate(
    async (rates) => chrome.storage.local.set({ rates: { rates, fetchedAt: Date.now(), source: 'listing', base: 'USD' } }),
    RATES
  );

  const shot = async (name, page) => {
    const file = path.join(OUT, name);
    await page.screenshot({ path: file });
    console.log(`  ${name}  ${Math.round(fs.statSync(file).size / 1024)}kb`);
  };

  // 1. chips on an ordinary product page
  const product = await context.newPage();
  await product.goto(`http://127.0.0.1:${port}/eur-modal.html`);
  await product.waitForTimeout(2500);
  await shot('01-chips.png', product);

  // 2. the panel over the store's own chart
  await product.click('#guide');
  await product.waitForTimeout(1500);
  await clickCta(product);
  await product.waitForTimeout(1200);
  await shot('02-panel.png', product);

  // 3. the hover verdict
  await product.evaluate(() => {
    const host = [...document.querySelectorAll('[data-ub-root]')].find((h) => h.shadowRoot && h.shadowRoot.querySelector('.wrap'));
    const tr = host && host.shadowRoot.querySelectorAll('tbody tr')[3];
    const td = tr && tr.cells[2];
    if (td) td.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  });
  await product.waitForTimeout(600);
  await shot('03-fit-verdict.png', product);
  await product.close();

  // 4. a chart of bare inches read into centimetres
  await worker.evaluate(async (s) => chrome.storage.sync.set({ settings: s }), { ...SETTINGS, length: 'cm', currency: 'EUR' });
  const inches = await context.newPage();
  await inches.goto(`http://127.0.0.1:${port}/usd-fractions.html`);
  await inches.waitForTimeout(2200);
  await clickCta(inches);
  await inches.waitForTimeout(1200);
  await shot('04-fractions.png', inches);
  await inches.close();

  // 5. settings
  await worker.evaluate(async (s) => chrome.storage.sync.set({ settings: s }), SETTINGS);
  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/src/options.html`);
  await options.waitForTimeout(1200);
  await shot('05-settings.png', options);
  await options.close();

  await context.close();
  server.close();
  console.log(`\n${OUT}`);
}

main();

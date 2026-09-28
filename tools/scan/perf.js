#!/usr/bin/env node
// Does the extension make pages slower? Loads each page twice — once with the
// extension, once without — and reads Chrome's own metrics. A release blocker
// if the answer is "noticeably".
//
//   node tools/scan/perf.js [--urls ...] [--limit 8]
const fs = require('fs');
const os = require('os');
const path = require('path');
const args = require('./lib/args.js')();
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const URLS = args.urls || path.join(__dirname, 'urls.txt');
const LIMIT = Number(args.limit || 8);
const SETTLE = Number(args.settle || 5000);

const REPEATS = Number(args.repeats || 3);

async function measure(url, withExtension) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ub-perf-'));
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    channel: 'chromium',
    args: withExtension ? [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`] : [],
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  // Long tasks are what a user feels: one 300ms block janks, six 50ms slices
  // do not.
  await page.addInitScript(() => {
    window.__longTasks = [];
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__longTasks.push(Math.round(entry.duration));
      }).observe({ entryTypes: ['longtask'] });
    } catch {
      /* not supported */
    }
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await page.waitForTimeout(SETTLE);
    const { metrics } = await cdp.send('Performance.getMetrics');
    const get = (name) => (metrics.find((m) => m.name === name) || {}).value || 0;
    const counts = await page.evaluate(() => ({
      nodes: document.querySelectorAll('*').length,
      chips: document.querySelectorAll('.ub-chip').length,
      longest: Math.max(0, ...(window.__longTasks || [])),
      longTasks: (window.__longTasks || []).length,
    }));
    return {
      script: Math.round(get('ScriptDuration') * 1000),
      layout: Math.round(get('LayoutDuration') * 1000),
      recalc: Math.round(get('RecalcStyleDuration') * 1000),
      ...counts,
    };
  } finally {
    await context.close();
  }
}

// Live sites vary run to run — ads, A/B tests, third-party scripts — and a
// single pass measured -82ms once, which is noise, not a speed-up. The local
// mode serves the e2e mock stores instead: identical every time.
async function localMain() {
  const { serve } = require('../../test/e2e/lib/server.js');
  const { server, port } = await serve(path.join(ROOT, 'test', 'e2e', 'sites'));
  const files = (args.files ? String(args.files).split(',') : ['heavy.html', 'eur-modal.html', 'usd-fractions.html', 'noise.html']);
  console.log(`\nLocal fixtures, median of ${REPEATS} runs each, ${SETTLE}ms settle\n`);
  console.log('  nodes  chips   base ms   with ms    delta   longest task (base → with)   fixture');
  for (const file of files) {
    const url = `http://127.0.0.1:${port}/${file}`;
    const runs = [];
    for (let i = 0; i < REPEATS; i++) {
      const base = await measure(url, false);
      const withExt = await measure(url, true);
      runs.push({
        base: base.script,
        with: withExt.script,
        chips: withExt.chips,
        nodes: withExt.nodes,
        longest: withExt.longest,
        baseLongest: base.longest,
      });
    }
    runs.sort((a, b) => a.with - a.base - (b.with - b.base));
    const mid = runs[Math.floor(runs.length / 2)];
    const delta = mid.with - mid.base;
    console.log(
      `  ${String(mid.nodes).padStart(5)}  ${String(mid.chips).padStart(5)}  ${String(mid.base).padStart(7)}   ` +
        `${String(mid.with).padStart(7)}  ${((delta >= 0 ? '+' : '') + delta).padStart(7)}   ` +
        `${String(mid.baseLongest).padStart(11)}ms → ${String(mid.longest).padStart(4)}ms        ${file}`
    );
  }
  server.close();
}

async function main() {
  if (args.local) return localMain();
  const urls = fs
    .readFileSync(URLS, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .slice(0, LIMIT);

  console.log(`\nScripting time with and without the extension, ${SETTLE}ms settle\n`);
  console.log('  nodes  chips   base ms   with ms    delta   page');
  const deltas = [];
  for (const url of urls) {
    try {
      const base = await measure(url, false);
      const withExt = await measure(url, true);
      const delta = withExt.script - base.script;
      deltas.push({ url, delta, base: base.script, with: withExt.script, chips: withExt.chips, nodes: withExt.nodes });
      console.log(
        `  ${String(withExt.nodes).padStart(5)}  ${String(withExt.chips).padStart(5)}  ` +
          `${String(base.script).padStart(7)}   ${String(withExt.script).padStart(7)}  ` +
          `${(delta >= 0 ? '+' : '') + delta}`.padStart(7) +
          `   ${url.replace(/^https?:\/\//, '').slice(0, 54)}`
      );
    } catch (err) {
      console.log(`      -      -        -         -        -   ${url.slice(0, 54)} (${err.message.split('\n')[0]})`);
    }
  }
  if (!deltas.length) return;
  const sorted = [...deltas].sort((a, b) => a.delta - b.delta);
  const median = sorted[Math.floor(sorted.length / 2)].delta;
  const worst = sorted[sorted.length - 1];
  console.log(`\n  median added scripting: ${median}ms`);
  console.log(`  worst:                  +${worst.delta}ms on ${worst.url.replace(/^https?:\/\//, '').slice(0, 60)} (${worst.chips} chips, ${worst.nodes} nodes)`);
}

main();

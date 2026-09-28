#!/usr/bin/env node
// Loads the real extension into a real Chromium and checks what it actually
// did to the page. Slower than the corpus scan, so it runs on a sample.
//
//   node tools/scan/browser.js [--limit 25] [--urls tools/scan/urls.txt]
//                              [--headed] [--shots] [--out browser-report.json]
//
// There is no ground truth for "the right conversion" on a stranger's website,
// so this checks invariants that must hold whatever the page contains:
//
//   1. a chip's length conversion is exactly right (lengths need no rates)
//   2. a chip's price conversion is within 20% of the bundled rate — enough to
//      catch a wrong currency or a factor of 100, not a stale rate
//   3. no chip inside an <input>, <textarea>, contenteditable, or <svg>
//   4. the original value is left intact inside its marker
//   5. chips don't multiply on a second look, and don't vanish unexplained
//      (a chart being found legitimately strips the chips inside it)
//   6. the extension logged no errors
//   7. where a size-guide control exists, the Open Chart button exists
require('../../src/lib/currencies.js');
require('../../src/lib/detect.js');
require('../../src/lib/convert.js');

const fs = require('fs');
const path = require('path');
const args = require('./lib/args.js')();

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright is not installed. Run:\n  npm install\n  npx playwright install chromium');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..', '..');
const URLS = args.urls || path.join(__dirname, 'urls.txt');
const LIMIT = Number(args.limit || 25);
const OUT = args.out || path.join(process.cwd(), 'browser-report.json');
const SETTLE = Number(args.settle || 3500);
const SHOTS = path.join(process.cwd(), 'scan-shots');

const RATES = UB.FALLBACK_RATES;
// Point the extension at units the pages are not already in, and every page
// converts something. A US store read in USD and inches correctly does nothing,
// which tests very little.
const SETTINGS = {
  ...UB.DEFAULT_SETTINGS,
  length: args.length || 'cm',
  currency: args.currency || 'EUR',
  chartAuto: true,
};

// What the page looks like after the extension has had a go at it.
function harvest() {
  const hits = [...document.querySelectorAll('.ub-hit')].map((hit) => {
    const chip = hit.querySelector('.ub-chip');
    const first = hit.firstChild;
    return {
      raw: hit.dataset.ub || '',
      chip: chip ? chip.textContent : null,
      original: first && first.nodeType === 3 ? first.nodeValue : null,
      badParent: !!hit.closest('input,textarea,[contenteditable=""],[contenteditable="true"]') || !!hit.ownerSVGElement,
    };
  });
  const triggerish = [...document.querySelectorAll('a,button,summary,[role="button"]')].some((el) =>
    /^\s*(size\s*(guide|chart)|guide des tailles|größentabelle)\s*[:>»→]?\s*$/i.test((el.textContent || '').trim())
  );
  return {
    hits,
    chips: document.querySelectorAll('.ub-chip').length,
    cta: document.querySelectorAll('.ub-cta').length,
    chartMarked: document.querySelectorAll('[data-ub-chart]').length,
    panel: !!document.querySelector('[data-ub-root]'),
    triggerish,
    title: document.title.slice(0, 80),
  };
}

function checkPage(state, second, errors) {
  const problems = [];
  for (const hit of state.hits) {
    let match;
    try {
      match = JSON.parse(hit.raw);
    } catch {
      problems.push({ why: 'marker has no parsable match data', text: hit.original });
      continue;
    }
    if (hit.badParent) problems.push({ why: 'marked inside an input or SVG', text: match.text });
    if (hit.original !== null && match.text && !hit.original.startsWith(match.text.slice(0, 4))) {
      problems.push({ why: 'original value was altered', text: `${match.text} → ${hit.original}` });
    }
    if (!hit.chip) continue;

    const expected = UB.convert(match, SETTINGS, RATES);
    if (!expected || !expected.primary) {
      problems.push({ why: 'chip shown where nothing should convert', text: match.text });
      continue;
    }
    if (match.kind === 'length') {
      if (hit.chip !== expected.primary) {
        problems.push({ why: `length chip wrong: expected ${expected.primary}`, text: `${match.text} → ${hit.chip}` });
      }
    } else {
      const shown = UB.detect.parseNumber(hit.chip.replace(/[^\d.,'  ]/g, '').trim());
      const want = UB.detect.parseNumber(expected.primary.replace(/[^\d.,'  ]/g, '').trim());
      if (!(shown > 0) || !(want > 0) || Math.abs(shown - want) / want > 0.2) {
        problems.push({ why: `price chip off by more than 20%: expected ~${expected.primary}`, text: `${match.text} → ${hit.chip}` });
      }
    }
  }
  // Chips going UP on a second look means something got marked twice. Going
  // down is legitimate: chips inside a detected chart are stripped, because the
  // panel is the conversion there. Only a drop with no chart is a real fault.
  if (second.chips > state.chips) {
    problems.push({ why: `marked twice: ${state.chips} → ${second.chips} chips`, text: '' });
  } else if (second.chips < state.chips && !second.chartMarked) {
    problems.push({ why: `chips vanished with no chart to explain it: ${state.chips} → ${second.chips}`, text: '' });
  }
  if (state.triggerish && !state.cta) problems.push({ why: 'size-guide control present but no Open Chart button', text: '' });
  for (const err of errors) problems.push({ why: 'extension logged an error', text: err.slice(0, 200) });
  return problems;
}

async function main() {
  const urls = fs
    .readFileSync(URLS, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .slice(0, LIMIT);

  if (args.shots) fs.mkdirSync(SHOTS, { recursive: true });

  const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ub-scan-'));
  // Extensions don't run in the old headless shell, so headless runs use the
  // full Chromium build ("channel: chromium" = Chrome's new headless mode).
  const context = await chromium.launchPersistentContext(profile, {
    headless: !args.headed,
    channel: args.headed ? undefined : 'chromium',
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
    viewport: { width: 1440, height: 900 },
  });

  // The extension's own service worker is the only thing that can write its
  // settings, and Playwright can evaluate inside it.
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 }).catch(() => null);
  if (worker) {
    await worker.evaluate(async (settings) => {
      await chrome.storage.sync.set({ settings });
    }, SETTINGS);
    console.log(`Extension set to read in ${SETTINGS.length} / ${SETTINGS.currency}\n`);
  } else {
    console.log('Could not reach the extension service worker; using its stored settings\n');
  }

  const results = [];
  for (const [i, url] of urls.entries()) {
    const page = await context.newPage();
    const errors = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (msg.type() === 'error' && /unit bubble/i.test(text)) errors.push(text);
    });
    page.on('pageerror', (err) => {
      if (/ub_|unit bubble|ub-/i.test(String(err))) errors.push(String(err));
    });

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(SETTLE);
      const state = await page.evaluate(harvest);
      await page.waitForTimeout(600);
      const second = await page.evaluate(harvest);
      const problems = checkPage(state, second, errors);
      results.push({ url, ...summarize(state), problems });
      const mark = problems.length ? '✗' : state.chips ? '✓' : '·';
      console.log(
        `${String(i + 1).padStart(3)}/${urls.length} ${mark} ${state.chips} chips` +
          `${state.cta ? ', cta' : ''}${state.chartMarked ? ', chart' : ''}  ${url}`
      );
      for (const p of problems.slice(0, 3)) console.log(`        ${p.why}${p.text ? `  «${p.text}»` : ''}`);
      if (args.shots && (problems.length || state.chartMarked)) {
        await page.screenshot({ path: path.join(SHOTS, `${String(i + 1).padStart(4, '0')}.png`), fullPage: false });
      }
    } catch (err) {
      results.push({ url, error: err.message.split('\n')[0], problems: [] });
      console.log(`${String(i + 1).padStart(3)}/${urls.length} ! ${err.message.split('\n')[0]}  ${url}`);
    }
    await page.close();
  }
  await context.close();

  const withChips = results.filter((r) => r.chips).length;
  const broken = results.filter((r) => r.problems && r.problems.length);
  fs.writeFileSync(
    OUT,
    JSON.stringify({ ranAt: new Date().toISOString(), totals: { pages: results.length, withChips, broken: broken.length }, results }, null, 2)
  );
  console.log(`\n${withChips}/${results.length} pages got chips · ${broken.length} with problems`);
  console.log(`Full report → ${OUT}`);
  process.exitCode = broken.length ? 1 : 0;
}

function summarize(state) {
  return { chips: state.chips, cta: state.cta, chartMarked: state.chartMarked, title: state.title };
}

main();

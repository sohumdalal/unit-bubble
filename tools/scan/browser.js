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
//   5. no marker sits inside another, and nothing convertible on the page is
//      left unconverted
//   6. the extension logged no errors
//   7. where a size-guide control exists, the Open Chart button exists
require('../../src/lib/currencies.js');
require('../../src/lib/detect.js');
require('../../src/lib/convert.js');
require('../../src/lib/sizechart.js');

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

// Ours, by the files in the stack. Content scripts report as
// chrome-extension:// frames.
const OURS = /chrome-extension:\/\/|\b(content|panel|sizechart|fit|detect|convert|currencies)\.js|Unit Bubble/i;

const TRIGGER_SOURCE = UB.chart.TRIGGER.source;
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
function harvest(triggerSource) {
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
  // The extension's own TRIGGER pattern, passed in, so the scan and the product
  // agree on what a size-guide label is. A narrower copy reported nine false
  // failures.
  const trigger = new RegExp(triggerSource, 'i');
  const norm = (text) => String(text || '').replace(/[^\p{L}\p{N}&]+/gu, ' ').trim();
  const triggerish = [...document.querySelectorAll('*')].some((el) => {
    if (el.children.length > 2) return false;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join('');
    const text = norm(own);
    return !!text && text.length <= 40 && trigger.test(text);
  });
  return {
    hits,
    chips: document.querySelectorAll('.ub-chip').length,
    cta: document.querySelectorAll('.ub-cta').length,
    chartMarked: document.querySelectorAll('[data-ub-chart]').length,
    nested: document.querySelectorAll('.ub-hit .ub-hit, .ub-chip .ub-chip').length,
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
  // Double-marking is a marker inside a marker — not simply "more chips than
  // before", which is what a page lazy-loading another section looks like.
  if (second.nested) problems.push({ why: `marked twice: ${second.nested} nested markers`, text: '' });
  // Counting chips before and after says nothing useful: a page that removes
  // its own carousel looks identical to one where we lost our markers. The
  // property worth checking is completeness — is anything convertible still
  // sitting there unconverted? That is computed from the page's own text in
  // checkCompleteness below.
  // A button is promised only where there is a chart to deliver, so the
  // invariant runs the other way: a chart that was read must offer a button,
  // and a button must never appear with neither a chart nor a control.
  if (state.chartMarked && !state.cta) problems.push({ why: 'chart read but no Open Chart button', text: '' });
  if (state.cta && !state.chartMarked && !state.triggerish) {
    problems.push({ why: 'button shown with neither a chart nor a size-guide control', text: '' });
  }
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
    const foreign = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (msg.type() === 'error' && /unit bubble/i.test(text)) errors.push(text);
    });
    // Capture every page error so nothing can hide — a TypeError that named
    // neither the extension nor its symbols once stayed hidden for three
    // rounds — but attribute them. A store's own broken payment script is not
    // our failure, and counting it as one buries the ones that are.
    page.on('pageerror', (err) => {
      const text = String(err.stack || err).slice(0, 400);
      (OURS.test(text) ? errors : foreign).push(text);
    });

    const problemsFromPanel = [];
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(SETTLE);
      let state = await page.evaluate(harvest, TRIGGER_SOURCE);
      await page.waitForTimeout(600);
      let second = await page.evaluate(harvest, TRIGGER_SOURCE);
      if (second.chips < state.chips) {
        await page.waitForTimeout(1800); // let a re-rendering page recover
        const third = await page.evaluate(harvest, TRIGGER_SOURCE);
        second = { ...third, recovered: third.chips >= state.chips };
      }
      // Most charts sit behind the store's own modal, so a scan that never
      // clicks anything can't tell whether the panel works. This is the metric
      // that matters: of the pages offering a chart, on how many does the
      // panel actually open with readable rows?
      // If we offer no button, act like a shopper and open the store's own
      // guide, then look again. Otherwise the measurement only covers pages
      // whose chart was already visible.
      if (!state.cta) {
        const opened = await page.evaluate(() => {
          const norm = (t) => String(t || '').replace(/[^\p{L}\p{N}&]+/gu, ' ').trim();
          const el = [...document.querySelectorAll('*')].find((e) => {
            if (e.children.length > 2) return false;
            const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join('');
            if (!/^(size\s*(guide|chart)|measuring\s*guide|size\s*&?\s*fit)$/i.test(norm(own))) return false;
            const box = e.getBoundingClientRect();
            return box.width > 0 && box.height > 0;
          });
          if (!el) return false;
          el.click();
          return true;
        });
        if (opened) {
          await page.waitForTimeout(1800);
          state = await page.evaluate(harvest, TRIGGER_SOURCE);
        }
      }

      let panel = null;
      if (state.cta) {
        const clickCtaOnce = () =>
          page.evaluate(() => {
            const cta = document.querySelector('.ub-cta');
            if (cta) cta.click();
            return !!cta;
          });
        const panelOpen = () =>
          page.evaluate(() =>
            [...document.querySelectorAll('[data-ub-root]')].some((h) => h.shadowRoot && h.shadowRoot.querySelector('.wrap'))
          );

        await clickCtaOnce();
        await page.waitForTimeout(1400);
        // Only click again if the first click opened the store's guide rather
        // than our panel. Clicking twice regardless toggled drawer-based stores
        // shut again, which looked like our chips vanishing.
        if (!(await panelOpen())) {
          await clickCtaOnce();
          await page.waitForTimeout(1400);
        }
        panel = await page.evaluate(() => {
          const host = [...document.querySelectorAll('[data-ub-root]')].find(
            (h) => h.shadowRoot && h.shadowRoot.querySelector('.wrap')
          );
          const wrap = host && host.shadowRoot.querySelector('.wrap');
          if (!wrap) return { open: false };
          const rows = [...wrap.querySelectorAll('tbody tr')];
          return {
            open: true,
            rows: rows.length,
            cols: rows[0] ? rows[0].cells.length : 0,
            headers: [...wrap.querySelectorAll('thead th')].map((th) => th.textContent.trim()),
            firstRow: rows[0] ? [...rows[0].cells].map((td) => td.textContent.trim()) : [],
            emptyCells: rows.reduce((n, tr) => n + [...tr.cells].filter((td) => td.textContent.trim() === '—').length, 0),
          };
        });
        if (panel.open && (!panel.rows || panel.rows < 2)) {
          problemsFromPanel.push({ why: `panel opened with ${panel.rows} rows`, text: '' });
        }
      }

      // Completeness: take the page's visible text that is not already marked,
      // run the real detector over it, and see what is left behind.
      const leftovers = await page.evaluate(() => {
        const out = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            const text = node.nodeValue;
            if (!text || !/\d/.test(text)) return NodeFilter.FILTER_REJECT;
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            if (parent.closest('.ub-hit,.ub-chip,.ub-cta,[data-ub-root],[data-ub-chart]')) return NodeFilter.FILTER_REJECT;
            if (parent.closest('script,style,noscript,textarea,input,select,option,template,[contenteditable]')) {
              return NodeFilter.FILTER_REJECT;
            }
            if (parent.ownerSVGElement) return NodeFilter.FILTER_REJECT;
            const box = parent.getBoundingClientRect();
            if (!box.width && !box.height) return NodeFilter.FILTER_REJECT; // hidden
            return NodeFilter.FILTER_ACCEPT;
          },
        });
        while (out.length < 400 && walker.nextNode()) out.push(walker.currentNode.nodeValue);
        return out;
      });
      const missed = [];
      for (const text of leftovers) {
        for (const match of UB.detect.findMatches(text, SETTINGS)) {
          const conv = UB.convert(match, SETTINGS, RATES);
          if (conv && conv.primary) missed.push(match.text);
        }
      }
      if (missed.length) {
        problemsFromPanel.push({
          why: `${missed.length} convertible values left unconverted`,
          text: missed.slice(0, 6).join(' · '),
        });
      }

      const problems = checkPage(state, second, errors).concat(problemsFromPanel);
      results.push({ url, ...summarize(state), panel, foreign: foreign.length, problems });
      const mark = problems.length ? '✗' : state.chips ? '✓' : '·';
      console.log(
        `${String(i + 1).padStart(3)}/${urls.length} ${mark} ${String(state.chips).padStart(3)} chips` +
          `${state.cta ? ', cta' : ''}${panel && panel.open ? `, panel ${panel.rows}x${panel.cols}` : ''}` +
          `${foreign.length ? `, ${foreign.length} site errors` : ''}  ${url.replace(/^https?:\/\//, '').slice(0, 58)}`
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
  const withCta = results.filter((r) => r.cta).length;
  const panelOpened = results.filter((r) => r.panel && r.panel.open).length;
  const broken = results.filter((r) => r.problems && r.problems.length);
  fs.writeFileSync(
    OUT,
    JSON.stringify({ ranAt: new Date().toISOString(), totals: { pages: results.length, withChips, broken: broken.length }, results }, null, 2)
  );
  console.log(
    `\n${withChips}/${results.length} pages got chips · ` +
      `${panelOpened}/${withCta} offered a chart and opened the panel · ` +
      `${broken.length} with problems of ours`
  );
  console.log(`Full report → ${OUT}`);
  process.exitCode = broken.length ? 1 : 0;
}

function summarize(state) {
  return { chips: state.chips, cta: state.cta, chartMarked: state.chartMarked, title: state.title };
}

main();

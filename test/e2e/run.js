#!/usr/bin/env node
// End-to-end suite: the real extension, in a real Chromium, against mock stores
// built out of the patterns that have actually broken it.
//
//   npm run e2e                 all cases
//   npm run e2e -- --only svg   cases whose name contains "svg"
//   HEADED=1 npm run e2e        watch it happen
//
// Every case also asserts on flashing, which the page-world watcher makes
// measurable: our elements being added and then taken away again.
const { open, ui, clickCta, clickToggle, dismissPanel, hoverCell, watchPanel } = require('./lib/harness.js');
const args = require('../../tools/scan/lib/args.js')();

const RATES = { USD: 1, EUR: 0.92, GBP: 0.79, CHF: 0.9, SEK: 10.5, JPY: 151, INR: 83.4, PLN: 3.98, BRL: 5.05, ARS: 880, PKR: 278, KRW: 1355 };
const IN_USD = { length: 'in', currency: 'USD' };
const CM_EUR = { length: 'cm', currency: 'EUR' };

let failures = 0;
let checks = 0;

function reporter(caseName) {
  const lines = [];
  const t = {
    ok(label, condition, detail = '') {
      checks += 1;
      if (condition) return;
      failures += 1;
      lines.push(`    ✗ ${label}${detail ? `\n        ${detail}` : ''}`);
    },
    eq(label, got, want) {
      t.ok(label, JSON.stringify(got) === JSON.stringify(want), `got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
    },
    near(label, got, want, tol) {
      t.ok(label, Math.abs(got - want) <= tol, `got ${got}, want ~${want} (±${tol})`);
    },
    // Our own elements appearing and then being removed is what a flash is.
    noFlashes(state, { allowChipRemoval = false, maxCta = 1 } = {}) {
      const count = (kind, type) => state.events.filter((e) => e.kind === kind && e.type === type).length;
      if (!allowChipRemoval) {
        t.ok('no chip was added then removed', count('chip', 'remove') === 0, `${count('chip', 'add')} added, ${count('chip', 'remove')} removed`);
      }
      t.ok('the button was created at most once', count('cta', 'add') <= maxCta, `${count('cta', 'add')} adds`);
      t.ok('the button was never removed', count('cta', 'remove') === 0, `${count('cta', 'remove')} removals`);
      t.ok('no marker host was removed', count('host', 'remove') === 0, `${count('host', 'remove')} removals`);
    },
    clean(page) {
      t.ok('no page errors', page.__errors.length === 0, page.__errors.slice(0, 2).join('\n        '));
    },
    lines,
  };
  return t;
}

const CASES = [
  {
    name: 'eur-modal · chips, chart in a modal, toggle, dismiss and reopen',
    file: 'eur-modal.html',
    settings: { ...IN_USD, profiles: { tops: { chest: 57 }, jackets: {}, pants: {} } },
    async run(t, page) {
      let s = await ui(page);
      const price = s.hits.find((h) => (h.original || '').includes('65'));
      t.ok('the price is marked', !!price, JSON.stringify(s.hits.map((h) => h.original)));
      t.eq('the price converts', price && price.chip, '$70.65');
      t.ok('the code stays with the price', (price.original || '').includes('EUR'), price && price.original);
      const height = s.hits.find((h) => (h.original || '').includes('1m82'));
      t.eq('French height notation converts', height && height.chip, '5′ 11.7″');
      t.eq('the button is there and visible', [s.cta, s.ctaVisible], [1, true]);
      t.eq('the button says what it does', s.ctaText, 'Open Chart');
      t.ok('the panel waits to be asked', !s.panel);
      t.ok('nothing in an input or an SVG', !s.hits.some((h) => h.inBadPlace));

      // The store opens its own guide.
      await page.click('#guide');
      await page.waitForTimeout(1400);
      s = await ui(page);
      t.eq('the chart is recognised', s.charts, 1);
      t.ok('no chips were sprayed across the chart', !s.hits.some((h) => h.inChart && h.chip), 'chips inside the chart');
      t.eq('still exactly one button', s.cta, 1);

      t.ok('the button opens the panel', await clickCta(page));
      // The panel's shadow root only exists once it has opened, so watch from
      // here and count the renders each later action causes.
      await watchPanel(page);
      s = await ui(page);
      t.ok('the panel is open', s.panel);
      t.eq('headers are read off the chart', s.headers, ['Size', 'Shoulders (A)', 'Chest (B)', 'Back (C)', 'Sleeves (D)']);
      t.eq('six sizes', s.rows.length, 6);
      t.eq('the first row is converted', s.rows[0], ['XS', '18.5″', '21.3″', '22.8″', '8.3″']);
      t.eq('a 57cm chest picks S', s.pickedRow, 'S');
      t.ok('the store guide is still open', await page.evaluate(() => document.getElementById('modal').classList.contains('open')));

      t.ok('the cm side of the toggle works', await clickToggle(page, 'cm'));
      s = await ui(page);
      t.eq('original units come back', s.rows[0], ['XS', '47cm', '54cm', '58cm', '21cm']);
      t.ok('clicking our toggle did not dismiss the store guide', await page.evaluate(() => document.getElementById('modal').classList.contains('open')));
      await clickToggle(page, 'in');
      s = await ui(page);
      t.eq('and converts back', s.rows[0], ['XS', '18.5″', '21.3″', '22.8″', '8.3″']);

      const tip = await hoverCell(page, 3, 2); // L, Chest (63cm) against a 57cm chest
      t.ok('hovering a cell explains the fit', tip && /vs your/.test(tip.text), tip && tip.text);
      t.ok('and gives a verdict', tip && /boxy|roomy|spot on|snug/.test(tip.text), tip && tip.text);

      t.eq('two toggle clicks cause exactly two renders', s.panelWraps, 2);

      await dismissPanel(page);
      t.ok('dismissing closes it', !(await ui(page)).panel);
      await clickCta(page);
      t.ok('and the button opens it again', (await ui(page)).panel);
      await dismissPanel(page);
      await clickCta(page);
      t.ok('twice', (await ui(page)).panel);

      t.noFlashes(await ui(page));
      t.clean(page);
    },
  },
  {
    name: 'usd-fractions · vulgar fractions, a $0 placeholder, inline chart',
    file: 'usd-fractions.html',
    settings: CM_EUR,
    async run(t, page) {
      const s = await ui(page);
      t.ok('no chip on a zero price', !s.hits.some((h) => (h.original || '').trim() === '$0'), 'a $0 got a chip');
      const prose = s.hits.filter((h) => /[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/.test(h.original || ''));
      t.ok(
        'vulgar fractions in prose convert',
        prose.length >= 3,
        `${prose.length} found; all markers: ${JSON.stringify(s.hits.map((h) => (h.original || '').trim()))}`
      );
      t.eq('22½ inches is 57.2 cm', (prose.find((h) => (h.original || '').includes('22½')) || {}).chip, '57.2 cm');
      t.eq('the chart is recognised', s.charts, 1);
      await watchPanel(page);
      await clickCta(page);
      const open = await ui(page);
      t.eq('five sizes', open.rows.length, 5);
      t.eq('bare fractional cells convert', open.rows[0], ['S', '52.1 cm', '43.8 cm', '69.9 cm', '21 cm']);
      t.eq('the unit was inferred as inches', open.toggles.map((x) => x.label), ['in', 'cm']);
      t.noFlashes(open);
      t.clean(page);
    },
  },
  {
    name: 'transposed · sizes across the top, unitless fractional cells',
    file: 'transposed.html',
    settings: CM_EUR,
    async run(t, page) {
      const s = await ui(page);
      t.eq('the chart is recognised', s.charts, 1);
      await watchPanel(page);
      await clickCta(page);
      const open = await ui(page);
      t.eq('sizes became the rows', open.rows.map((r) => r[0]), ['S', 'M', 'L', 'XL']);
      t.eq('measurements became the headers', open.headers, ['Size', 'LENGTH', 'CHEST', 'SHOULDER', 'SLEEVE']);
      t.eq('XL length is 64.8 cm', open.rows[3][1], '64.8 cm');
      t.noFlashes(open);
      t.clean(page);
    },
  },
  {
    name: 'svg-chart · SVG text is read, never written to',
    file: 'svg-chart.html',
    settings: IN_USD,
    async run(t, page) {
      const s = await ui(page);
      t.eq('the SVG chart is recognised', s.charts, 1);
      t.ok('nothing was injected into the SVG', !s.hits.some((h) => h.inBadPlace), 'a marker landed in the SVG');
      t.ok('the SVG still renders its own text', await page.evaluate(() => /96 cm/.test(document.querySelector('svg').textContent)));
      await watchPanel(page);
      await clickCta(page);
      const open = await ui(page);
      t.eq('four sizes', open.rows.length, 4);
      t.eq('headers come off the SVG', open.headers, ['Size', 'Chest', 'Waist', 'Length']);
      t.eq('96cm is 37.8 inches', open.rows[0][1], '37.8″');
      t.noFlashes(open);
      t.clean(page);
    },
  },
  {
    name: 'late-hydration · nothing exists at document_idle',
    file: 'late-hydration.html',
    settings: IN_USD,
    settle: 3600,
    async run(t, page) {
      let s = await ui(page);
      t.ok('the late price still got a chip', s.chipCount >= 1, `${s.chipCount} chips`);
      t.eq('the late size guide still got a button', s.cta, 1);
      await watchPanel(page);
      await clickCta(page);
      await page.waitForTimeout(1500);
      s = await ui(page);
      t.ok('the button opened the store guide and the panel followed', s.panel, JSON.stringify({ charts: s.charts, cta: s.cta }));
      t.eq('four sizes', s.rows.length, 4);
      t.noFlashes(s);
      t.clean(page);
    },
  },
  {
    name: 'spa-rerender · the page throws our markers away repeatedly',
    file: 'spa-rerender.html',
    settings: IN_USD,
    settle: 7500,
    async run(t, page) {
      const s = await ui(page);
      t.ok('markers recovered after the last re-render', s.chipCount >= 4, `${s.chipCount} chips`);
      t.ok('no marker nested inside another', await page.evaluate(() => !document.querySelector('.ub-hit .ub-hit')));
      t.ok('no chip inside a chip', await page.evaluate(() => !document.querySelector('.ub-chip .ub-chip')));
      const adds = s.events.filter((e) => e.kind === 'chip' && e.type === 'add').length;
      t.ok('marking did not run away', adds <= 80, `${adds} chip insertions across 6 re-renders`);
      t.eq('one chip per value, not two', s.chipCount, await page.evaluate(() => document.querySelectorAll('.ub-hit').length));
      t.clean(page);
    },
  },
  {
    name: 'noise · prose that must be left completely alone',
    file: 'noise.html',
    settings: IN_USD,
    async run(t, page) {
      const s = await ui(page);
      t.eq('not a single chip', s.chipCount, 0);
      t.eq('not a single marker', s.hits.length, 0);
      t.ok('the input is untouched', await page.evaluate(() => document.querySelector('input').value.includes('30 cm')));
      t.ok('contenteditable is untouched', await page.evaluate(() => !document.querySelector('[contenteditable] .ub-hit')));
      t.eq('no button, since there is no chart', s.cta, 0);
      t.noFlashes(s);
      t.clean(page);
    },
  },
  {
    name: 'noise (metric reader) · still nothing',
    file: 'noise.html',
    settings: CM_EUR,
    async run(t, page) {
      const s = await ui(page);
      t.eq('not a single chip', s.chipCount, 0);
      t.clean(page);
    },
  },
  {
    name: 'dialog-chart · a native modal dialog makes the page inert',
    file: 'dialog-chart.html',
    settings: IN_USD,
    async run(t, page) {
      let s = await ui(page);
      const price = s.hits.find((h) => (h.original || '').includes('1'));
      t.eq("Swiss apostrophe grouping converts", price && price.chip, '$1,443.33');
      await page.click('#guide');
      await page.waitForTimeout(1400);
      s = await ui(page);
      t.eq('the chart inside the dialog is recognised', s.charts, 1);
      await watchPanel(page);
      await clickCta(page);
      s = await ui(page);
      t.ok('the panel opens over a modal dialog', s.panel);
      t.ok('and is still interactive there', await clickToggle(page, 'cm'));
      s = await ui(page);
      t.eq('the toggle worked inside the dialog', s.rows[0], ['46', '96 cm', '42 cm', '62 cm']);
      t.noFlashes(s);
      t.clean(page);
    },
  },
  {
    name: 'grid-fr · a CSS grid of divs with French labels',
    file: 'grid-fr.html',
    settings: IN_USD,
    async run(t, page) {
      const s = await ui(page);
      t.eq('the grid chart is recognised', s.charts, 1);
      await watchPanel(page);
      await clickCta(page);
      const open = await ui(page);
      t.eq('five sizes', open.rows.length, 5);
      t.eq('French headers are read', open.headers, ['Size', 'Poitrine', 'Longueur', 'Manches']);
      t.eq('88cm is 34.6 inches', open.rows[0][1], '34.6″');
      t.noFlashes(open);
      t.clean(page);
    },
  },
  {
    name: 'decoys · a nav link and a hidden duplicate must not win',
    file: 'decoys.html',
    settings: CM_EUR,
    async run(t, page) {
      let s = await ui(page);
      t.eq('exactly one button', s.cta, 1);
      t.ok('and it is visible', s.ctaVisible);
      const placed = await page.evaluate(() => {
        const cta = document.querySelector('.ub-cta');
        return {
          insideNav: !!cta.closest('nav'),
          insideDrawer: !!cta.closest('#drawer'),
          nextToRealGuide: cta.previousElementSibling === document.getElementById('guide') || cta.parentElement === document.getElementById('guide'),
        };
      });
      t.ok('not attached to the nav link', !placed.insideNav);
      t.ok('not attached inside the collapsed drawer', !placed.insideDrawer);
      t.ok('attached to the control that opens the chart', placed.nextToRealGuide, JSON.stringify(placed));

      t.ok('the button opens the store guide', await clickCta(page, 1400));
      t.ok('the store guide opened, not a navigation', await page.evaluate(() => document.getElementById('modal').classList.contains('open')));
      t.ok('we are still on the same page', page.url().endsWith('decoys.html'));
      await page.waitForTimeout(900);
      s = await ui(page);
      t.eq('the chart was found', s.charts, 1);
      await clickCta(page);
      s = await ui(page);
      t.ok('and the panel opens', s.panel);
      t.eq('four sizes', s.rows.length, 4);
      t.noFlashes(s);
      t.clean(page);
    },
  },
  {
    name: 'nav-only · a link to another page is not something to open',
    file: 'nav-only.html',
    settings: IN_USD,
    async run(t, page) {
      const s = await ui(page);
      t.ok('the measurements still convert', s.chipCount >= 3, `${s.chipCount} chips`);
      t.eq('no button, because there is nothing to open here', s.cta, 0);
      t.noFlashes(s);
      t.clean(page);
    },
  },
  {
    name: 'currencies · every price format on one page',
    file: 'currencies.html',
    settings: IN_USD,
    async run(t, page) {
      const s = await ui(page);
      const by = (text) => s.hits.find((h) => (h.original || '').replace(/\s/g, '').includes(text.replace(/\s/g, '')));
      const cases = [
        ['1.299,00', 'EUR', 1412],
        ["1'299.00", 'CHF', 1443],
        ['1,23,456', 'INR', 1480],
        ['128,000', 'JPY', 848],
        ['13 990', 'SEK', 1332],
        ['5 499,00', 'PLN', 1382],
        ['6.499,00', 'BRL', 1287],
        ['1 200 000', 'ARS', 1364],
        ['360,000', 'PKR', 1295],
        ['1,690,000', 'KRW', 1247],
      ];
      for (const [text, code, dollars] of cases) {
        const hit = by(text);
        t.ok(`${code} (${text}) is marked`, !!hit, `not found among ${s.hits.length} markers`);
        if (!hit) continue;
        const match = JSON.parse(hit.match || '{}');
        t.eq(`${code} is read as ${code}`, match.code, code);
        const shown = Number((hit.chip || '').replace(/[^\d.]/g, ''));
        t.near(`${code} converts to about $${dollars}`, Math.round(shown), dollars, Math.max(2, dollars * 0.01));
      }
      t.ok('the US row is left alone', !by('$1,299.00'), 'a USD price got a chip while reading USD');
      t.noFlashes(s);
      t.clean(page);
    },
  },
];

async function main() {
  const only = args.only ? String(args.only).toLowerCase() : null;
  const cases = only ? CASES.filter((c) => c.name.toLowerCase().includes(only)) : CASES;
  const h = await open();
  console.log(`\nEnd-to-end: ${cases.length} cases against mock stores on port ${h.port}\n`);

  for (const testCase of cases) {
    await h.rates(RATES);
    await h.settings({
      ...testCase.settings,
      chartAuto: false,
      chipPrices: true,
      chipMeasurements: true,
      debug: !!args.debug,
    });
    const t = reporter(testCase.name);
    const page = await h.page(testCase.file, { settle: testCase.settle || 1600 });
    try {
      await testCase.run(t, page, h);
    } catch (err) {
      failures += 1;
      t.lines.push(`    ✗ the case itself threw\n        ${String(err.stack || err).split('\n').slice(0, 3).join('\n        ')}`);
    }
    await page.close();
    console.log(`${t.lines.length ? '✗' : '✓'} ${testCase.name}`);
    for (const line of t.lines) console.log(line);
    if (t.lines.length && args.debug) {
      for (const log of page.__logs.filter((l) => l.includes('[Unit Bubble]'))) {
        console.log(`    · ${log.slice(0, 900)}`);
      }
    }
  }

  await h.close();
  console.log(`\n${checks - failures}/${checks} checks passed across ${cases.length} cases`);
  process.exitCode = failures ? 1 : 0;
}

main();

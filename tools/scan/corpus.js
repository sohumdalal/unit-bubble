#!/usr/bin/env node
// Scans thousands of real pages without a browser: fetch the HTML, take the
// text, and run the extension's own detector over it. This is the mode that
// scales — it says what the detector finds, what it gets suspicious about, and
// which numeric strings it walked past, which is where missing patterns show up.
//
//   node tools/scan/corpus.js [--urls tools/scan/urls.txt] [--limit 1000]
//                             [--concurrency 6] [--out scan-report.json]
require('../../src/lib/currencies.js');
require('../../src/lib/detect.js');
require('../../src/lib/convert.js');
require('../../src/lib/sizechart.js');

const fs = require('fs');
const path = require('path');
const args = require('./lib/args.js')();
const { get, pool } = require('./lib/fetch.js');

const URLS = args.urls || path.join(__dirname, 'urls.txt');
const LIMIT = Number(args.limit || 1000);
const CONCURRENCY = Number(args.concurrency || 6);
const OUT = args.out || path.join(process.cwd(), 'scan-report.json');
const SETTINGS = { ...UB.DEFAULT_SETTINGS, length: args.length || 'in', currency: args.currency || 'USD' };
const RATES = UB.FALLBACK_RATES;

// Values so far outside clothing and homeware that they are almost certainly a
// parse error rather than a real measurement.
const IMPLAUSIBLE_MM = 200000; // 200m
const IMPLAUSIBLE_MONEY = 5e7;

const NUMERIC = /\d/;
const SIZE_LABEL = /size\s*(guide|chart)|guide des tailles|größentabelle|tabella taglie|tabla de tallas/i;

// Entities a browser resolves before the extension ever sees the text.
// Fractions matter most: the first scan reported "17&frac14;" as a miss when
// the extension would really have been handed "17¼".
const ENTITIES = {
  nbsp: '\u00a0', thinsp: '\u2009', ensp: '\u2002', emsp: '\u2003',
  amp: '&', quot: '"', apos: "'", lsquo: '\u2018', rsquo: '\u2019',
  ldquo: '\u201c', rdquo: '\u201d', ndash: '\u2013', mdash: '\u2014',
  hellip: '\u2026', copy: '\u00a9', reg: '\u00ae', trade: '\u2122',
  euro: '\u20ac', pound: '\u00a3', yen: '\u00a5', cent: '\u00a2',
  times: '\u00d7', deg: '\u00b0', prime: '\u2032', Prime: '\u2033',
  frac12: '\u00bd', frac14: '\u00bc', frac34: '\u00be',
  frac13: '\u2153', frac23: '\u2154',
  frac15: '\u2155', frac25: '\u2156', frac35: '\u2157', frac45: '\u2158',
  frac16: '\u2159', frac56: '\u215a',
  frac18: '\u215b', frac38: '\u215c', frac58: '\u215d', frac78: '\u215e',
};

function decode(text) {
  return text
    .replace(/&([a-zA-Z][a-zA-Z0-9]{1,8});/g, (whole, name) =>
      ENTITIES[name] !== undefined ? ENTITIES[name] : whole
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)));
}

function textNodes(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .split(/<[^>]*>/)
    .map((t) => decode(t).trim())
    .filter(Boolean);
}

// A numeric string the detector ignored. Reported so real misses surface, with
// the obvious non-measurements filtered out so the list stays readable.
const BORING = /^\d{4}$|^\d+%$|^#?\d+$|^\(?\+?\d[\d\s().-]{6,}$|©|\bgsm\b|\bml\b|\bkg\b|\boz\b|\blb\b/i;

function scanPage(html) {
  const nodes = textNodes(html);
  const money = [];
  const lengths = [];
  const suspicious = [];
  const missed = new Set();
  let chartCells = 0;

  for (const text of nodes) {
    if (!NUMERIC.test(text)) continue;
    const matches = UB.detect.findMatches(text, SETTINGS);

    if (UB.chart.parseCell(text)) chartCells += 1;

    if (!matches.length) {
      // A bare "17¼" is not a miss: prose needs a unit, and a chart cell is the
      // chart reader's job, counted above. Keeping them apart is what makes
      // this list worth reading.
      const short = text.length <= 40 && !UB.chart.parseCell(text) ? text : '';
      if (short && !BORING.test(short) && /\d/.test(short)) missed.add(short);
      continue;
    }

    for (const m of matches) {
      const conv = UB.convert(m, SETTINGS, RATES);
      const row = { text: m.text, kind: m.kind };
      if (m.kind === 'money') {
        row.code = m.code;
        row.value = m.value;
        money.push(row);
        if (!(m.value > 0) || m.value > IMPLAUSIBLE_MONEY) suspicious.push({ ...row, why: 'implausible amount' });
        if (conv && conv.primary === null) suspicious.push({ ...row, why: `no rate for ${m.code}` });
      } else {
        row.mm = Math.round(m.mm * 10) / 10;
        row.unit = m.unit;
        lengths.push(row);
        if (!(m.mm > 0) || m.mm > IMPLAUSIBLE_MM) suspicious.push({ ...row, why: 'implausible length' });
      }
      // Overlapping spans would mean double-marking on a real page.
      for (const other of matches) {
        if (other === m) continue;
        if (m.start < other.end && other.start < m.end) {
          suspicious.push({ ...row, why: `overlaps "${other.text}"` });
          break;
        }
      }
    }
  }

  const hasSizeLabel = nodes.some((t) => t.length <= 40 && (SIZE_LABEL.test(t) || UB.chart.looksLikeTrigger(t)));
  return { money, lengths, suspicious, missed: [...missed].slice(0, 12), chartCells, hasSizeLabel, nodes: nodes.length };
}

async function main() {
  if (!fs.existsSync(URLS)) {
    console.error(`No URL list at ${URLS}. Run: npm run scan:discover`);
    process.exit(1);
  }
  const urls = fs
    .readFileSync(URLS, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .slice(0, LIMIT);

  console.log(`Scanning ${urls.length} pages, reading in ${SETTINGS.length} / ${SETTINGS.currency}\n`);
  const started = Date.now();
  let done = 0;

  const pages = await pool(urls, CONCURRENCY, async (url) => {
    const res = await get(url);
    done += 1;
    if (done % 25 === 0) process.stdout.write(`  ${done}/${urls.length}\r`);
    if (!res.ok) return { url, ok: false, error: res.error || `HTTP ${res.status}` };
    try {
      return { url, ok: true, ...scanPage(res.body) };
    } catch (err) {
      return { url, ok: false, error: `scan failed: ${err.message}` };
    }
  });

  const good = pages.filter((p) => p.ok);
  const failed = pages.filter((p) => !p.ok);
  const sum = (key) => good.reduce((n, p) => n + p[key].length, 0);
  const currencies = {};
  const units = {};
  for (const p of good) {
    for (const m of p.money) currencies[m.code] = (currencies[m.code] || 0) + 1;
    for (const l of p.lengths) units[l.unit] = (units[l.unit] || 0) + 1;
  }
  const withMoney = good.filter((p) => p.money.length).length;
  const withLength = good.filter((p) => p.lengths.length).length;
  const chartish = good.filter((p) => p.chartCells >= 6 || p.hasSizeLabel).length;
  const suspicious = good.flatMap((p) => p.suspicious.map((s) => ({ ...s, url: p.url })));

  const report = {
    ranAt: new Date().toISOString(),
    settings: { length: SETTINGS.length, currency: SETTINGS.currency },
    totals: {
      requested: urls.length,
      fetched: good.length,
      failed: failed.length,
      prices: sum('money'),
      measurements: sum('lengths'),
      pagesWithPrices: withMoney,
      pagesWithMeasurements: withLength,
      pagesLookingChartLike: chartish,
      suspicious: suspicious.length,
    },
    currencies,
    units,
    suspicious: suspicious.slice(0, 120),
    missedSamples: good.flatMap((p) => p.missed.map((t) => ({ url: p.url, text: t }))).slice(0, 200),
    failures: failed.slice(0, 60),
    pages: good.map((p) => ({
      url: p.url,
      prices: p.money.length,
      measurements: p.lengths.length,
      chartCells: p.chartCells,
      sizeLabel: p.hasSizeLabel,
      suspicious: p.suspicious.length,
    })),
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  const pct = (n) => (good.length ? `${Math.round((n / good.length) * 100)}%` : '—');
  console.log(`\nFetched ${good.length}/${urls.length} in ${Math.round((Date.now() - started) / 1000)}s`);
  console.log(`  prices found         ${report.totals.prices} on ${withMoney} pages (${pct(withMoney)})`);
  console.log(`  measurements found   ${report.totals.measurements} on ${withLength} pages (${pct(withLength)})`);
  console.log(`  chart-like pages     ${chartish} (${pct(chartish)})`);
  console.log(`  suspicious matches   ${suspicious.length}`);
  console.log(`  currencies seen      ${Object.keys(currencies).sort().join(' ') || '—'}`);
  console.log(`  units seen           ${Object.keys(units).sort().join(' ') || '—'}`);
  if (suspicious.length) {
    console.log('\nSuspicious (first 10):');
    for (const s of suspicious.slice(0, 10)) console.log(`  · ${s.why.padEnd(24)} "${s.text}"  ${s.url}`);
  }
  console.log(`\nFull report → ${OUT}`);
  process.exitCode = suspicious.length ? 1 : 0;
}

main();

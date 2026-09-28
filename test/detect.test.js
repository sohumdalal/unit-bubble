// Run with: node test/detect.test.js
// Pure detection/conversion checks — no browser, no network.
require('../src/lib/currencies.js');
require('../src/lib/detect.js');
require('../src/lib/convert.js');

const S = { ...UB.DEFAULT_SETTINGS };
const RATES = { USD: 1, EUR: 0.9, GBP: 0.8, JPY: 150, SEK: 10, PLN: 4 };

let pass = 0;
const fails = [];

function check(name, got, want) {
  if (got === want) pass++;
  else fails.push(`${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`);
}

function first(text, settings = S) {
  const m = UB.detect.findMatches(text, settings)[0];
  if (!m) return null;
  return m.kind === 'money' ? `${m.code} ${m.value}` : `${Math.round(m.mm * 100) / 100}mm`;
}

// --- numbers -----------------------------------------------------------------
check('us grouping', UB.detect.parseNumber('1,299.00'), 1299);
check('eu grouping', UB.detect.parseNumber('1.299,00'), 1299);
check('space grouping', UB.detect.parseNumber('1 299'), 1299);
check('eu decimal', UB.detect.parseNumber('19,99'), 19.99);
check('plain', UB.detect.parseNumber('899'), 899);
check('millions', UB.detect.parseNumber('1.234.567'), 1234567);

// --- lengths -----------------------------------------------------------------
check('cm attached', first('81cm waist'), '810mm');
check('cm spaced', first('63.5 cm'), '635mm');
check('metres', first('sofa is 2.4 m wide'), '2400mm');
check('mm', first('45 mm thick'), '45mm');
check('inches word', first('9 inches long'), '228.6mm');
check('feet+inches', first('5\'10" tall'), '1778mm');
check('inch mark', first('screen 27"'), '685.8mm');
check('french height', first('Quentin is 1m82 and wears M'), '1820mm');
check('french height short', first('elle mesure 1m8'), '1800mm');
check('spaced m is not compound', first('1 m 82 cm apart'), '1000mm');

// --- not lengths -------------------------------------------------------------
check('minutes', first('ready in 5 minutes'), null);
check('million', first('raised 5 M in seed'), null);
check('inside', first('3 inside pockets'), null);

// --- money -------------------------------------------------------------------
check('euro symbol', first('€19,99'), 'EUR 19.99');
check('euro code after', first('1.299,00 EUR'), 'EUR 1299');
check('usd grouped', first('$1,299.00'), 'USD 1299');
check('gbp', first('£45'), 'GBP 45');
check('yen default', first('¥12,800'), 'JPY 12800');
check('krona default', first('19 800 kr'), 'SEK 19800');
check('zloty', first('zł129'), 'PLN 129');
check('yen as cny', first('¥100', { ...S, yenMeans: 'CNY' }), 'CNY 100');
check('dollar as cad', first('$100', { ...S, dollarMeans: 'CAD' }), 'CAD 100');

// --- conversion --------------------------------------------------------------
const conv = (text, settings = S) => {
  const m = UB.detect.findMatches(text, settings)[0];
  const c = m && UB.convert(m, settings, RATES);
  return c && c.primary;
};
check('cm to in', conv('20 cm'), '7.87 in');
check('long cm to ft-in', conv('183 cm'), '6′ 0″');
check('in to cm', conv('30 in', { ...S, length: 'cm' }), '76.2 cm');
check('eur to usd', conv('€90'), '$100.00');
check('usd to eur', conv('$100', { ...S, currency: 'EUR' }), '€90.00');
check('jpy to usd rounds', conv('¥15,000'), '$100.00');
check('same unit skipped', conv('12 in'), null);
check('same currency skipped', conv('$12'), null);
check('missing rate is flagged', (() => {
  const m = UB.detect.findMatches('₹500', S)[0];
  const c = UB.convert(m, S, RATES);
  return c.note;
})(), 'No rate for INR');

// --- ordering / overlap ------------------------------------------------------
check('multiple in one string', UB.detect.findMatches('Waist 81cm, price €49,99', S).length, 2);
check('overlap kept once', UB.detect.findMatches('5\'10"', S).length, 1);

console.log(`${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log('\n' + fails.map((f) => '  ✗ ' + f).join('\n'));
  process.exit(1);
}

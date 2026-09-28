// Run with: node test/units.test.js
// Exhaustive measurement coverage: every unit spelling the detector claims to
// know, both notations for compound heights, and the exact output string for
// each target unit across every magnitude the formatter switches on.
require('../src/lib/currencies.js');
require('../src/lib/detect.js');
require('../src/lib/convert.js');

const S = { ...UB.DEFAULT_SETTINGS };
let pass = 0;
const fails = [];
const check = (name, got, want) =>
  got === want ? pass++ : fails.push(`${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`);
const near = (name, got, want, tol) =>
  Math.abs(got - want) <= tol ? pass++ : fails.push(`${name}\n    got  ${got}\n    want ~${want} (±${tol})`);

const mm = (text, settings = S) => {
  const m = UB.detect.findMatches(text, settings).find((x) => x.kind === 'length');
  return m ? Math.round(m.mm * 1000) / 1000 : null;
};

/* 1. Every spelling in the unit table, spaced and attached ---------------- */
const UNITS = UB.detect.LENGTH_UNITS;
for (const [spelling, factor] of Object.entries(UNITS)) {
  const word = /[a-z]/i.test(spelling);
  check(`5 ${spelling} spaced`, mm(`5 ${spelling}`), 5 * factor);
  check(`5${spelling} attached`, mm(`5${spelling}`), 5 * factor);
  check(`12.5 ${spelling} decimal`, mm(`12.5 ${spelling}`), Math.round(12.5 * factor * 1000) / 1000);
  check(`0.5 ${spelling} sub-unit`, mm(`0.5 ${spelling}`), Math.round(0.5 * factor * 1000) / 1000);
  if (word) {
    check(`uppercase ${spelling.toUpperCase()}`, mm(`5 ${spelling.toUpperCase()}`), spelling === 'm' ? null : 5 * factor);
    check(`in a sentence: ${spelling}`, mm(`the strap is 5 ${spelling} across`), 5 * factor);
  }
}

/* 2. Every unit family maps to the right canonical unit ------------------ */
for (const [spelling, factor] of Object.entries(UNITS)) {
  const expected = factor === 1 ? 'mm' : factor === 10 ? 'cm' : factor === 1000 ? 'm' : factor === 25.4 ? 'in' : 'ft';
  check(`normalize ${spelling}`, UB.detect.normalizeLengthUnit(spelling), expected);
}

/* 3. Compound heights, both conventions ---------------------------------- */
const COMPOUND = [
  ["5'10\"", 5 * 304.8 + 10 * 25.4],
  ['5’10”', 5 * 304.8 + 10 * 25.4],
  ["6'2\"", 6 * 304.8 + 2 * 25.4],
  ['5 ft 10 in', 5 * 304.8 + 10 * 25.4],
  ['5ft10in', 5 * 304.8 + 10 * 25.4],
  ['5 feet 10 inches', 5 * 304.8 + 10 * 25.4],
  ["5'10.5\"", 5 * 304.8 + 10.5 * 25.4],
  ['1m82', 1820],
  ['1m8', 1800],
  ['1m75', 1750],
  ['2m05', 2050],
];
for (const [text, want] of COMPOUND) check(`compound ${text}`, mm(text), Math.round(want * 1000) / 1000);

/* 3b. Vulgar fractions — how US charts are actually written --------------- */
// Found by scanning 3sixteen, which writes 17¼ and 28⅞ rather than 17 1/4.
for (const [text, want] of [
  ['16½ in', 16.5 * 25.4],
  ['17¼ in', 17.25 * 25.4],
  ['28⅞ in', 28.875 * 25.4],
  ['33¾ in', 33.75 * 25.4],
  ['22½"', 22.5 * 25.4],
  ['17 ¼ in', 17.25 * 25.4],
  ['15⅛ in', 15.125 * 25.4],
  ['29⅝ in', 29.625 * 25.4],
  ['⅞ in', 0.875 * 25.4],
  ['20⅓ cm', (20 + 1 / 3) * 10],
]) {
  check(`vulgar fraction ${text}`, mm(text), Math.round(want * 1000) / 1000);
}
check('bare vulgar fraction is not a length', mm('17¼'), null);
check('parseNumber reads a vulgar fraction', UB.detect.parseNumber('17¼'), 17.25);
check('parseNumber reads a lone one', UB.detect.parseNumber('½'), 0.5);

/* 4. Exact output for every magnitude the formatter switches on ---------- */
const TO_INCHES = [
  ['8 mm', '0.31 in'],
  ['9.9 mm', '0.39 in'],
  ['1 cm', '0.39 in'],
  ['20 cm', '7.87 in'],
  ['63.5 cm', '25 in'],
  ['91.4 cm', '35.98 in'],   // just under the 3ft switch
  ['1 m', '3′ 3.4″'],
  ['1.82 m', '5′ 11.7″'],
  ['2.4 m', '7′ 10.5″'],
  ['1m82', '5′ 11.7″'],
];
for (const [text, want] of TO_INCHES) {
  const m = UB.detect.findMatches(text, S)[0];
  check(`to inches: ${text}`, UB.convert(m, S, {}).primary, want);
}

const CM = { ...S, length: 'cm' };
const TO_CM = [
  ['0.25 in', '6.4 mm'],
  ['1 in', '2.5 cm'],
  ['30 in', '76.2 cm'],
  ['27"', '68.6 cm'],
  ['3 ft', '91.4 cm'],
  ['8 ft', '2.44 m'],
  ["5'10\"", '1.78 m'],
  ['6 feet', '1.83 m'],
];
for (const [text, want] of TO_CM) {
  const m = UB.detect.findMatches(text, CM)[0];
  check(`to cm: ${text}`, UB.convert(m, CM, {}).primary, want);
}

/* 5. No-op conversions are skipped -------------------------------------- */
for (const text of ['12 in', '3 ft', '27"', "5'10\""]) {
  check(`skipped in inch mode: ${text}`, UB.convert(UB.detect.findMatches(text, S)[0], S, {}), null);
}
for (const text of ['20 cm', '8 mm', '2.4 m', '1m82']) {
  check(`skipped in cm mode: ${text}`, UB.convert(UB.detect.findMatches(text, CM)[0], CM, {}), null);
}

/* 6. Round trip stays inside a tenth of a millimetre -------------------- */
for (const cm of [1, 5, 12.5, 47, 63.5, 100, 182, 240]) {
  near(`round trip ${cm}cm`, (mm(`${cm} cm`) / 25.4) * 25.4, cm * 10, 0.1);
}

/* 7. Multiple measurements in one string -------------------------------- */
const many = UB.detect.findMatches('55 cm × 40 cm × 23 cm', S);
check('three dimensions found', many.length, 3);
check('dimensions in order', many.map((m) => m.mm).join(','), '550,400,230');
check(
  'mixed units in one string',
  UB.detect.findMatches('81cm waist, 34 in inseam, 2.5 mm sole', S).map((m) => Math.round(m.mm)).join(','),
  '810,864,3'
);

/* 8. What must never be read as a measurement --------------------------- */
for (const text of [
  'ready in 5 minutes',
  'raised 5 M in seed',
  '3 inside pockets',
  'Heavyweight 290 GSM cotton',
  'LOOKBOOK ’26',
  'BRUT Clothing 2026',
  'Chapter 12 in the manual',
  'section 5 min read',
  '1 in 4 people',
  '5 in stock',
  '3 in total',
  'included in 2 of the sets',
  'first 10 in line',
]) {
  check(`not a measurement: ${text}`, mm(text), null);
}

console.log(`${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log('\n' + fails.slice(0, 25).map((f) => '  ✗ ' + f).join('\n'));
  if (fails.length > 25) console.log(`  … and ${fails.length - 25} more`);
  process.exit(1);
}

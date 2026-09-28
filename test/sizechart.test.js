// Run with: node test/sizechart.test.js
// Feeds the chart reader the rectangles a browser would report, so grid
// reconstruction, orientation and unit inference are all testable without one.
require('../src/lib/currencies.js');
require('../src/lib/detect.js');
require('../src/lib/convert.js');
require('../src/lib/sizechart.js');
require('../src/lib/fit.js');

let pass = 0;
const fails = [];
const check = (name, got, want) =>
  got === want ? pass++ : fails.push(`${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`);

const rect = (left, top, w = 34, h = 16) => ({ left, top, right: left + w, bottom: top + h });
const cell = (text, left, top, w) => ({ ...UB.chart.parseCell(text), rect: rect(left, top, w) });

/* 1. Cell parsing -------------------------------------------------------- */
check('cell with unit', JSON.stringify(UB.chart.parseCell('47cm')), JSON.stringify({ value: 47, unit: 'cm', mm: 470 }));
check('cell spaced unit', UB.chart.parseCell('63.5 cm').mm, 635);
check('cell inch mark', UB.chart.parseCell('27"').mm, 685.8);
check('cell bare', JSON.stringify(UB.chart.parseCell('23')), JSON.stringify({ value: 23, unit: null, mm: null }));
check('cell mixed fraction', UB.chart.parseCell('25 1/2').value, 25.5);
check('cell quarter', UB.chart.parseCell('24 1/4').value, 24.25);
check('cell three quarters', UB.chart.parseCell('22 3/4').value, 22.75);
check('cell bare fraction', UB.chart.parseCell('1/2').value, 0.5);
check('cell fraction with unit', UB.chart.parseCell('21 1/2 in').mm, 546.1);
check('cell comma decimal', UB.chart.parseCell('63,5 cm').mm, 635);
check('cell rejects words', UB.chart.parseCell('CHEST'), null);
check('cell rejects mixed text', UB.chart.parseCell('47cm chest'), null);
check('cell rejects zero', UB.chart.parseCell('0'), null);

/* 2. Sizes down the rows (brut-clothing: cm, units in every cell) -------- */
const COLS = [720, 950, 1180, 1400];
const ROWS = [440, 485, 528, 570, 614, 657];
const DATA = [
  [47, 54, 58, 21],
  [50, 57, 60, 22],
  [53, 60, 62, 23],
  [57, 63, 64, 24],
  [61, 67, 66, 25],
  [65, 71, 69, 26],
];
const cmItems = [];
DATA.forEach((row, r) => row.forEach((v, c) => cmItems.push(cell(`${v}cm`, COLS[c], ROWS[r]))));
const cmLabels = [
  { text: 'Size', rect: rect(530, 395, 40) },
  { text: 'Shoulders (A)', rect: rect(690, 395, 100) },
  { text: 'Chest (B)', rect: rect(930, 395, 80) },
  { text: 'Back (C)', rect: rect(1165, 395, 70) },
  { text: 'Sleeves (D)', rect: rect(1380, 395, 90) },
  ...['XS', 'S', 'M', 'L', 'XL', 'XXL'].map((t, i) => ({ text: t, rect: rect(535, ROWS[i], 26) })),
];

const cmGrid = UB.chart.orient(UB.chart.attachLabels(UB.chart.buildGrid(cmItems), cmLabels));
check('cm grid rows', cmGrid.cells.length, 6);
check('cm grid cols', cmGrid.cells[0].length, 4);
check('cm grid not transposed', cmGrid.transposed, false);
check('cm headers', cmGrid.headers.join('|'), 'Shoulders (A)|Chest (B)|Back (C)|Sleeves (D)');
check('cm row labels', cmGrid.rowLabels.join(','), 'XS,S,M,L,XL,XXL');
check('cm unit from cells', UB.chart.inferUnit(cmItems), 'cm');
check('cm pick for 57cm chest', cmGrid.rowLabels[UB.chart.pickSize(cmGrid, { chest: 570 }, ['chest']).row], 'S');

/* 3. Sizes across the top, bare fractional inches ------------------------ */
// The layout in the screenshot: measurements down the side, sizes along the top.
const TCOL = [440, 660, 870, 1090];
const TROW = [82, 152, 227, 299];
const TDATA = [
  ['22', '23', '24', '25 1/2'],       // LENGTH
  ['23', '24 1/4', '25 1/4', '26 1/2'], // CHEST
  ['20', '21', '20 1/2', '22 1/2'],   // SHOULDER
  ['21 1/2', '22 1/2', '22 3/4', '23'], // SLEEVE
];
const tItems = [];
TDATA.forEach((row, r) => row.forEach((v, c) => tItems.push(cell(v, TCOL[c], TROW[r], 46))));
const tLabels = [
  ...['S', 'M', 'L', 'XL'].map((t, i) => ({ text: t, rect: rect(TCOL[i], 12, 18) })),
  ...['LENGTH', 'CHEST', 'SHOULDER', 'SLEEVE'].map((t, i) => ({ text: t, rect: rect(10, TROW[i], 140) })),
];

const tRaw = UB.chart.buildGrid(tItems);
check('transposed detected', tRaw.transposed, true);
check('ordered across, not down', tRaw.down < tRaw.across, true);
const tGrid = UB.chart.orient(UB.chart.attachLabels(tRaw, tLabels));
check('transposed rows are sizes', tGrid.rowLabels.join(','), 'S,M,L,XL');
check('transposed headers are measurements', tGrid.headers.join(','), 'LENGTH,CHEST,SHOULDER,SLEEVE');
check('transposed cell count', tGrid.cells.length * tGrid.cells[0].length, 16);
check('transposed roles', tGrid.headers.map(UB.chart.columnRole).join(','), 'length,chest,shoulders,sleeve');

check('bare values look like a chart', UB.chart.looksLikeSizes(tGrid.rowLabels), true);
check('headers look like measurements', UB.chart.looksLikeMeasurements(tGrid.headers), true);
check('unit inferred from magnitude', UB.chart.inferUnit(tItems), 'in');
check('unit applied to bare cells', UB.chart.applyUnit(tItems, 'in'), true);
check('bare cell now has mm', Math.round(tGrid.cells[3][1].mm * 10) / 10, Math.round(26.5 * 25.4 * 10) / 10);
check(
  'pick for a 24.5in chest',
  tGrid.rowLabels[UB.chart.pickSize(tGrid, { chest: 24.5 * 25.4 }, ['chest']).row],
  'L'
);

/* 4. Unit inference ------------------------------------------------------ */
const bare = (v) => ({ value: v, unit: null, mm: null, rect: rect(0, 0) });
check('text says inches', UB.chart.inferUnit([bare(50)], 'All measurements in inches'), 'in');
check('text says cm', UB.chart.inferUnit([bare(20)], 'Toutes les mesures en cm'), 'cm');
check('text says mm', UB.chart.inferUnit([bare(20)], 'thickness in mm'), 'mm');
check('inch magnitudes', UB.chart.inferUnit([bare(21), bare(23), bare(25)]), 'in');
check('cm magnitudes', UB.chart.inferUnit([bare(47), bare(54), bare(58)]), 'cm');
check('ambiguous magnitudes give up', UB.chart.inferUnit([bare(38), bare(40), bare(42)]), null);
check('explicit units win over text', UB.chart.inferUnit(cmItems, 'measurements in inches'), 'cm');

/* 5. Size-label shapes --------------------------------------------------- */
check('letter sizes', UB.chart.looksLikeSizes(['XS', 'S', 'M', 'L', 'XL', 'XXL']), true);
check('numeric sizes', UB.chart.looksLikeSizes(['36', '38', '40', '42']), true);
check('2XL style', UB.chart.looksLikeSizes(['M', 'L', '2XL', '3XL']), true);
check('prose is not sizes', UB.chart.looksLikeSizes(['Free shipping', 'Returns', 'Delivery']), false);
check('one label is not enough', UB.chart.looksLikeSizes(['M']), false);

/* 6. What must not be read as a chart ------------------------------------ */
const jumbled = [];
[[47, 12, 58], [9, 71, 3], [53, 40, 62], [18, 63, 7], [61, 22, 66]].forEach((row, r) =>
  row.forEach((v, c) => jumbled.push(cell(`${v}cm`, COLS[c], ROWS[r])))
);
check('jumbled grid rejected', UB.chart.buildGrid(jumbled), null);

const cards = [];
[[108, 63.5, 2.5], [81, 84, 28.5], [46, 14, 200], [55, 40, 23]].forEach((card, i) =>
  card.forEach((v, c) => cards.push(cell(`${v}cm`, 200 + (i % 2) * 400 + c * 90, 300 + Math.floor(i / 2) * 220)))
);
check('product cards rejected', UB.chart.buildGrid(cards), null);
check('single column rejected', UB.chart.buildGrid(ROWS.map((top, i) => cell(`${40 + i}cm`, 720, top))), null);
check('two cells rejected', UB.chart.buildGrid(cmItems.slice(0, 2)), null);

const descending = [];
[...DATA].reverse().forEach((row, r) => row.forEach((v, c) => descending.push(cell(`${v}cm`, COLS[c], ROWS[r]))));
check('descending chart accepted', UB.chart.buildGrid(descending).cells.length, 6);

/* 7. Ragged columns (divs, not a table) still reconstruct ---------------- */
const ragged = [];
DATA.forEach((row, r) =>
  row.forEach((v, c) => ragged.push(cell(`${v}cm`, COLS[c] + (r % 2 ? 7 : -6), ROWS[r] + (c % 2 ? 2 : -3))))
);
const rg = UB.chart.buildGrid(ragged);
check('ragged rows', rg && rg.cells.length, 6);
check('ragged cols', rg && rg.cells[0].length, 4);
check('ragged fill', rg && rg.filled, 24);

/* 8. Fit verdicts -------------------------------------------------------- */
check('chest 2in over is boxy', UB.fit.verdict('chest', 2 * 25.4).text, 'boxy');
check('chest exact is spot on', UB.fit.verdict('chest', 0).text, 'spot on');
check('chest 1in under is too tight', UB.fit.verdict('chest', -25.4).text, 'too tight');
check('chest slightly under is snug', UB.fit.verdict('chest', -8).text, 'snug');
check('chest 1in over is roomy', UB.fit.verdict('chest', 25.4).text, 'roomy');
check('shoulders 1.5in over is dropped', UB.fit.verdict('shoulders', 38).text, 'dropped shoulder');
check('shoulders 0.2in over is spot on', UB.fit.verdict('shoulders', 5).text, 'spot on');
check('sleeve 1in short', UB.fit.verdict('sleeve', -25.4).text, 'too short');
check('sleeve 2in long', UB.fit.verdict('sleeve', 50).text, 'too long');
check('inseam uses length scale', UB.fit.verdict('inseam', 0).family, 'length');
check('neck has its own scale', UB.fit.verdict('neck', -8).text, 'too tight');
check('unknown role has no verdict', UB.fit.verdict('elbow', 0), null);
check('diff formats in inches', UB.fit.formatDiff(2 * 25.4, 'in'), '+2″');
check('diff formats in cm', UB.fit.formatDiff(-15, 'cm'), '−1.5 cm');
check('zero diff', UB.fit.formatDiff(0, 'in'), '±0″');

/* 9. Size-guide trigger text --------------------------------------------- */
for (const text of [
  'Size Guide',
  'SIZE CHART',
  'Size guide →',
  'size guide:',
  'Sizing',
  'Size & Fit',
  'Size and fit',
  'Fit Guide',
  'Measurements',
  'Garment measurements',
  'Size Table',
  'Size info',
  'Guide des tailles',
  'Tableau des tailles',
  'Größentabelle',
  'Grossentabelle',
  'Guía de tallas',
  'Tabla de tallas',
  'Tabella taglie',
  'Tabella delle taglie',
  'Storleksguide',
]) {
  check(`trigger: ${text}`, UB.chart.looksLikeTrigger(text), true);
}
for (const text of [
  'Add to cart',
  'Size',
  'Select size',
  'Medium',
  '',
  'Guide',
  'Shipping & Returns',
  'This size guide explains how we measure every garment we sell, in detail',
  'Description',
]) {
  check(`not a trigger: ${text}`, UB.chart.looksLikeTrigger(text), false);
}

/* 10. Profile detection -------------------------------------------------- */
check('inseam column means pants', UB.fit.detectProfile(['Waist', 'Inseam'], 'Corduroy'), 'pants');
check('jacket from the page', UB.fit.detectProfile(['Chest', 'Shoulders'], 'Wool Chore Jacket'), 'jackets');
check('tee from the page', UB.fit.detectProfile(['Chest', 'Shoulders'], 'The Best Pocket Tee'), 'tops');
check('jeans from the page', UB.fit.detectProfile([], 'Slim Fit Jeans'), 'pants');
check('waist and seat only', UB.fit.detectProfile(['Waist', 'Seat'], ''), 'pants');

console.log(`${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log('\n' + fails.slice(0, 25).map((f) => '  ✗ ' + f).join('\n'));
  process.exit(1);
}

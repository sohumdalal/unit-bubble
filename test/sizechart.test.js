// Run with: node test/sizechart.test.js
// Feeds the chart reader the rectangles a browser would report, so the grid
// reconstruction can be tested without a browser.
require('../src/lib/currencies.js');
require('../src/lib/detect.js');
require('../src/lib/convert.js');
require('../src/lib/sizechart.js');

let pass = 0;
const fails = [];
const check = (name, got, want) =>
  got === want ? pass++ : fails.push(`${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`);

const rect = (left, top, w = 34, h = 16) => ({ left, top, right: left + w, bottom: top + h });
const cm = (v, left, top) => ({ mm: v * 10, unit: 'cm', text: `${v}cm`, rect: rect(left, top) });

// The brut-clothing chart: 6 sizes x 4 measurements.
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
const items = [];
DATA.forEach((row, r) => row.forEach((v, c) => items.push(cm(v, COLS[c], ROWS[r]))));

const labels = [
  { text: 'Size', rect: rect(530, 395, 40) },
  { text: 'Shoulders (A)', rect: rect(690, 395, 100) },
  { text: 'Chest (B)', rect: rect(930, 395, 80) },
  { text: 'Back (C)', rect: rect(1165, 395, 70) },
  { text: 'Sleeves (D)', rect: rect(1380, 395, 90) },
  ...['XS', 'S', 'M', 'L', 'XL', 'XXL'].map((t, i) => ({ text: t, rect: rect(535, ROWS[i], 26) })),
];

const grid = UB.chart.buildGrid(items);
check('grid found', !!grid, true);
check('rows', grid.cells.length, 6);
check('cols', grid.colBands.length, 4);
check('every slot filled', grid.filled, 24);
check('first cell', grid.cells[0][0].mm, 470);
check('last cell', grid.cells[5][3].mm, 260);

UB.chart.attachLabels(grid, labels);
check('headers read', grid.headers.join('|'), 'Shoulders (A)|Chest (B)|Back (C)|Sleeves (D)');
check('row labels read', grid.rowLabels.join(','), 'XS,S,M,L,XL,XXL');

check('role: chest', UB.chart.columnRole('Chest (B)'), 'chest');
check('role: shoulders', UB.chart.columnRole('Shoulders (A)'), 'shoulders');
check('role: french chest', UB.chart.columnRole('Tour de poitrine'), 'chest');
check('role: none', UB.chart.columnRole('Sleeves (D)'), 'sleeve');

// Chest column is 54/57/60/63/67/71cm. The pick is the first row that is not
// smaller than you, which is how you read a flat-measurement chart.
const pick = UB.chart.pickSize(grid, { chest: 570 });
check('exact 57 picks S', grid.rowLabels[pick.row], 'S');
check('pick column is chest', pick.col, 1);
check('pick reports the role', pick.role, 'chest');
check('58.5 picks M', grid.rowLabels[UB.chart.pickSize(grid, { chest: 585 }).row], 'M');
check('64 picks XL', grid.rowLabels[UB.chart.pickSize(grid, { chest: 640 }).row], 'XL');
check('tiny chest picks XS', grid.rowLabels[UB.chart.pickSize(grid, { chest: 500 }).row], 'XS');
check('shoulders used when no chest', UB.chart.pickSize(grid, { shoulders: 530 }).col, 0);
check('huge chest picks largest', UB.chart.pickSize(grid, { chest: 900 }).over, true);
check('no measurements, no pick', UB.chart.pickSize(grid, {}), null);

// Rejections: prose, not a chart.
check('two values is not a chart', UB.chart.buildGrid(items.slice(0, 2)), null);
check(
  'one column is not a chart',
  UB.chart.buildGrid(ROWS.map((top, i) => cm(40 + i, 720, top))),
  null
);
check(
  'scattered prose is not a chart',
  UB.chart.buildGrid([cm(20, 100, 100), cm(30, 700, 140), cm(40, 250, 800), cm(5, 900, 1200), cm(8, 130, 1500), cm(9, 640, 1900)]),
  null
);

// A grid where the columns are ragged (divs, not a table) still reconstructs.
const ragged = [];
DATA.forEach((row, r) =>
  row.forEach((v, c) => ragged.push(cm(v, COLS[c] + (r % 2 ? 7 : -6), ROWS[r] + (c % 2 ? 2 : -3))))
);
const rg = UB.chart.buildGrid(ragged);
check('ragged rows', rg && rg.cells.length, 6);
check('ragged cols', rg && rg.colBands.length, 4);
check('ragged fill', rg && rg.filled, 24);

// The rule that keeps a grid of product cards from reading as a chart.
check('monotonic columns recorded', grid.monotonic, 1);
const jumbled = [];
[[47, 12, 58], [9, 71, 3], [53, 40, 62], [18, 63, 7], [61, 22, 66]].forEach((row, r) =>
  row.forEach((v, c) => jumbled.push(cm(v, COLS[c], ROWS[r])))
);
check('jumbled grid rejected', UB.chart.buildGrid(jumbled), null);

// Product cards: three measurements per card, cards laid out in a grid.
const cards = [];
[[108, 63.5, 2.5], [81, 84, 28.5], [46, 14, 200], [55, 40, 23]].forEach((card, i) =>
  card.forEach((v, c) => cards.push(cm(v, 200 + (i % 2) * 400 + c * 90, 300 + Math.floor(i / 2) * 220)))
);
check('product cards rejected', UB.chart.buildGrid(cards), null);

// A descending chart (some charts list XXL first) is still a chart.
const descending = [];
[...DATA].reverse().forEach((row, r) => row.forEach((v, c) => descending.push(cm(v, COLS[c], ROWS[r]))));
check('descending chart accepted', UB.chart.buildGrid(descending).cells.length, 6);

console.log(`${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log('\n' + fails.map((f) => '  ✗ ' + f).join('\n'));
  process.exit(1);
}

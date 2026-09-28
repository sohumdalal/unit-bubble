// Run with: node test/currencies.test.js
// Exhaustive currency coverage: every ISO code in both positions, every symbol
// in the table, every ambiguous-symbol choice, the number format of each
// locale that writes prices differently, and the conversion arithmetic for
// every currency we claim to support.
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

function money(text, settings = S) {
  const m = UB.detect.findMatches(text, settings).find((x) => x.kind === 'money');
  return m ? `${m.code} ${m.value}` : null;
}

const CODES = Object.keys(UB.CURRENCIES);

/* 1. Every ISO code, before and after the amount ------------------------- */
for (const code of CODES) {
  check(`code before: ${code}`, money(`${code} 100`), `${code} 100`);
  check(`code after: ${code}`, money(`100 ${code}`), `${code} 100`);
  check(`code after, grouped: ${code}`, money(`1,299.00 ${code}`), `${code} 1299`);
  check(`code lowercase: ${code}`, money(`100 ${code.toLowerCase()}`), `${code} 100`);
}

/* 2. Every symbol in the table, before and after ------------------------- */
for (const [symbol, code] of Object.entries(UB.SYMBOLS)) {
  check(`symbol before: ${symbol}`, money(`${symbol}100`), `${code} 100`);
  check(`symbol before, spaced: ${symbol}`, money(`${symbol} 100`), `${code} 100`);
  check(`symbol after: ${symbol}`, money(`100 ${symbol}`), `${code} 100`);
  check(`symbol with decimals: ${symbol}`, money(`${symbol}1,299.50`), `${code} 1299.5`);
}

/* 3. Ambiguous symbols follow the user's choice -------------------------- */
for (const [symbol, spec] of Object.entries(UB.AMBIGUOUS)) {
  const key = symbol === '$' ? 'dollarMeans' : symbol === '¥' ? 'yenMeans' : 'kronaMeans';
  for (const code of spec.options) {
    check(`${symbol} as ${code}`, money(`${symbol}100`, { ...S, [key]: code }), `${code} 100`);
  }
  check(`${symbol} default`, money(`${symbol}100`), `${spec.default} 100`);
}

/* 4. How each locale actually writes a price ----------------------------- */
const LOCALE_FORMATS = [
  ['en-US', '$1,299.00', 'USD 1299'],
  ['en-US cents', '$0.99', 'USD 0.99'],
  ['de-DE', '1.299,00 €', 'EUR 1299'],
  ['de-AT', '€ 1.299,00', 'EUR 1299'],
  ['it-IT', '€ 1.299', 'EUR 1299'],
  ['es-ES', '1.299,00€', 'EUR 1299'],
  ['fr-FR nbsp', '1 299,00 €', 'EUR 1299'],
  ['fr-FR narrow nbsp', '1 299,00 €', 'EUR 1299'],
  ['fr-FR cents', '19,99 €', 'EUR 19.99'],
  ['de-CH apostrophe', "CHF 1'299.00", 'CHF 1299'],
  ['de-CH suffix', "1'299.00 CHF", 'CHF 1299'],
  ['en-GB', '£1,299.99', 'GBP 1299.99'],
  ['en-IN lakh', '₹1,23,456', 'INR 123456'],
  ['en-IN lakh decimals', '₹1,23,456.50', 'INR 123456.5'],
  ['en-IN rupees word', 'Rs. 4,250', 'INR 4250'],
  ['ja-JP', '¥12,800', 'JPY 12800'],
  ['zh-CN', 'CN¥1,299', 'CNY 1299'],
  ['ko-KR', '₩1,299,000', 'KRW 1299000'],
  ['sv-SE', '1 299,00 kr', 'SEK 1299'],
  ['nb-NO', '1 299 kr', 'SEK 1299'],
  ['pl-PL', '1 299,00 zł', 'PLN 1299'],
  ['cs-CZ', '1 299 Kč', 'CZK 1299'],
  ['da-DK', 'kr 1.299,00', 'SEK 1299'],
  ['pt-BR', 'R$ 1.299,00', 'BRL 1299'],
  ['es-MX', 'MX$1,299.00', 'MXN 1299'],
  ['tr-TR', '₺1.299,00', 'TRY 1299'],
  ['ru-RU', '1 299,00 ₽', 'RUB 1299'],
  ['uk-UA', '1 299 ₴', 'UAH 1299'],
  ['he-IL', '₪1,299', 'ILS 1299'],
  ['th-TH', '฿1,299', 'THB 1299'],
  ['vi-VN', '1.299.000 ₫', 'VND 1299000'],
  ['id-ID', 'IDR 1.299.000', 'IDR 1299000'],
  ['ms-MY', 'RM1,299', 'MYR 1299'],
  ['zh-HK', 'HK$1,299', 'HKD 1299'],
  ['zh-TW', 'NT$1,299', 'TWD 1299'],
  ['en-SG', 'S$1,299', 'SGD 1299'],
  ['en-AU', 'A$1,299', 'AUD 1299'],
  ['en-CA', 'C$1,299', 'CAD 1299'],
  ['en-NZ', 'NZ$1,299', 'NZD 1299'],
  ['en-ZA', 'ZAR 1 299', 'ZAR 1299'],
  ['en-NG', '₦1,299', 'NGN 1299'],
  ['en-PH', '₱1,299', 'PHP 1299'],
  ['ar-AE', 'AED 1,299', 'AED 1299'],
  ['is-IS', 'ISK 1.299', 'ISK 1299'],
  ['hu-HU', 'HUF 1 299', 'HUF 1299'],
  ['ro-RO', 'RON 1.299,00', 'RON 1299'],
];
for (const [locale, text, want] of LOCALE_FORMATS) check(`format ${locale}: ${text}`, money(text), want);

/* 5. Conversion arithmetic, every currency ------------------------------- */
// A distinct rate per code, so a mixed-up lookup can't accidentally pass.
const RATES = {};
CODES.forEach((code, i) => {
  RATES[code] = code === 'USD' ? 1 : (i + 2) * 1.5;
});
const parseBack = (formatted) => UB.detect.parseNumber(formatted.replace(/[^\d.,'   ]/g, '').trim());

for (const code of CODES) {
  if (code === 'USD') continue;
  const m = UB.detect.findMatches(`${code} 100`, S)[0];
  const conv = UB.convert(m, S, RATES);
  const expected = 100 * (RATES.USD / RATES[code]);
  near(`${code} -> USD amount`, parseBack(conv.primary), expected, Math.max(expected * 0.01, 0.01));
  check(`${code} -> USD note`, conv.note.startsWith(`1 ${code} = `), true);

  // And the other direction: USD priced goods read in that currency.
  const back = UB.convert(UB.detect.findMatches('$100', S)[0], { ...S, currency: code }, RATES);
  const expectedBack = 100 * (RATES[code] / RATES.USD);
  near(`USD -> ${code} amount`, parseBack(back.primary), expectedBack, Math.max(expectedBack * 0.01, 1));
}

check('same currency is skipped', UB.convert(UB.detect.findMatches('$100', S)[0], S, RATES), null);
check(
  'missing rate is reported',
  UB.convert({ kind: 'money', code: 'EUR', value: 10 }, S, { USD: 1 }).note,
  'No rate for EUR'
);

/* 6. Zero-decimal currencies print no cents ------------------------------ */
for (const code of UB.ZERO_DECIMAL) {
  const out = UB.convert({ kind: 'money', code: 'USD', value: 100 }, { ...S, currency: code }, RATES);
  check(`${code} has no decimals`, /[.,]\d\d$/.test(out.primary), false);
}

/* 7. Prose that must not be read as money -------------------------------- */
for (const text of [
  'Chapter 12 in the manual',
  'ARS is the Argentine peso',
  'krona fell 3 percent',
  'Model R2 D2',
  'Room 3 of the hotel',
  'copyright 2026',
  'Section 5 min read',
]) {
  check(`not money: ${text}`, money(text), null);
}

console.log(`${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log('\n' + fails.slice(0, 30).map((f) => '  ✗ ' + f).join('\n'));
  if (fails.length > 30) console.log(`  … and ${fails.length - 30} more`);
  process.exit(1);
}

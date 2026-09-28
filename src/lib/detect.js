// Finds prices and measurements inside a plain string. Pure functions, no DOM —
// so the same code runs in the content script and in test/ scripts under node.
(function (root) {
  const UB = (root.UB = root.UB || {});

  const SPACE = '[ \\u00a0\\u202f\\u2009\\u2007]'; // space, nbsp, narrow/thin nbsp
  // A number with optional grouping and decimals: 1299, 1,299.00, 1.299,00, 1 299,00
  // Longest alternative first:
  //   1,23,456   Indian lakh grouping (pairs, then a triple)
  //   1'299.00   Swiss apostrophe grouping
  //   1.299,00 / 1 299,00 / 1,299.00 / 1299
  const GROUP = "[.,\\u00a0\\u202f\\u2009 '\\u2019]";
  const NUM =
    `\\d{1,2}(?:,\\d{2})+,\\d{3}(?:\\.\\d{1,4})?` +
    `|\\d{1,3}(?:${GROUP}\\d{3})*(?:[.,]\\d{1,4})?` +
    `|\\d+(?:[.,]\\d{1,4})?`;

  // Vulgar fractions, which US size charts use as often as "1/2" — 3sixteen
  // writes 17¼ and 28⅞. Found by scanning real stores.
  const VULGAR = {
    '¼': 0.25, '½': 0.5, '¾': 0.75,
    '⅐': 1 / 7, '⅑': 1 / 9, '⅒': 0.1,
    '⅓': 1 / 3, '⅔': 2 / 3,
    '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8,
    '⅙': 1 / 6, '⅚': 5 / 6,
    '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
  };
  const VULGAR_CLASS = `[${Object.keys(VULGAR).join('')}]`;
  const VULGAR_RE = new RegExp(`^(\\d+)?[\\s\\u00a0]*(${VULGAR_CLASS})$`);

  const LENGTH_UNITS = {
    mm: 1, millimeter: 1, millimeters: 1, millimetre: 1, millimetres: 1,
    cm: 10, centimeter: 10, centimeters: 10, centimetre: 10, centimetres: 10,
    m: 1000, meter: 1000, meters: 1000, metre: 1000, metres: 1000,
    in: 25.4, inch: 25.4, inches: 25.4, '"': 25.4, '”': 25.4, '″': 25.4,
    ft: 304.8, foot: 304.8, feet: 304.8, "'": 304.8, '’': 304.8, '′': 304.8,
  };
  // Longest spellings first so "centimeters" wins over "cm", "inches" over "in".
  const LENGTH_ALT = Object.keys(LENGTH_UNITS)
    .sort((a, b) => b.length - a.length)
    .map(esc)
    .join('|');

  // Bare "in" is a preposition far more often than it is a unit. "34 in inseam"
  // is a measurement; "12 in the manual" and "1 in 4 people" are not. Only the
  // two-letter spelling is ambiguous — inch/inches/" are always units.
  const IN_IS_PROSE = new RegExp(
    '^\\.?\\s+(?:the|a|an|this|that|these|those|my|our|your|their|his|her|its|' +
      'stock|store|total|addition|fact|case|order|place|time|use|which|all|any|each|every|both|' +
      'advance|between|front|person|people|line|charge|progress|question|full|part|two|three|four|' +
      'five|six|seven|eight|nine|ten|\\d)\\b',
    'i'
  );

  function esc(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // 5'10" / 5 ft 10 in — one measurement written as two numbers.
  const FEET_INCHES = new RegExp(
    `(?<![\\w.,])(\\d{1,2})${SPACE}*(?:'|’|′|ft\\.?|feet|foot)${SPACE}*(\\d{1,2}(?:[.,]\\d{1,2})?)${SPACE}*(?:"|”|″|in\\.?|inch(?:es)?)(?![\\w])`,
    'gi'
  );
  // French/Benelux height shorthand: 1m82 = 1.82 m. Written without spaces, which
  // is what keeps it from colliding with "1 m 82 cm apart".
  const METRE_CM = new RegExp(`(?<![\\w.,])(\\d)m(\\d{1,2})(?![\\w])`, 'g');
  // A length may be written as a mixed fraction: 25 1/2 in.
  const LENGTH_NUM =
    `\\d+[\\s\\u00a0]*${VULGAR_CLASS}` +
    `|${VULGAR_CLASS}` +
    `|\\d+[\\s\\u00a0]+\\d+\\s*\\/\\s*\\d+` +
    `|\\d+\\s*\\/\\s*\\d+` +
    `|${NUM}`;
  const LENGTH = new RegExp(
    `(?<![\\w.,$€£¥₹])(${LENGTH_NUM})${SPACE}*(${LENGTH_ALT})(?![\\w])`,
    'gi'
  );

  // Built once, then reused: symbol-before-number and number-before-symbol.
  let MONEY_PRE = null;
  let MONEY_POST = null;
  let CODE_RE = null;

  // A letter-based symbol needs a boundary, or "Rs" matches inside "ARS" and
  // "kr" inside "PKR" — both of which used to resolve to the wrong currency.
  function symbolAlternation(list) {
    return list
      .sort((a, b) => b.length - a.length)
      .map((sym) => {
        let re = esc(sym);
        if (/^[A-Za-z]/.test(sym)) re = `(?<![A-Za-z])${re}`;
        if (/[A-Za-z]$/.test(sym)) re = `${re}(?![A-Za-z])`;
        return re;
      })
      .join('|');
  }

  function buildMoneyRegexes() {
    const symbols = symbolAlternation(Object.keys(UB.SYMBOLS).concat(Object.keys(UB.AMBIGUOUS)));
    MONEY_PRE = new RegExp(`(${symbols})${SPACE}*(${NUM})(?![\\d])`, 'gi');
    MONEY_POST = new RegExp(`(?<![\\w.,])(${NUM})${SPACE}*(${symbols})(?![\\w])`, 'gi');
    const codes = Object.keys(UB.CURRENCIES).join('|');
    CODE_RE = new RegExp(
      `(?:\\b(${codes})${SPACE}*(${NUM})(?![\\d])|(?<![\\w.,])(${NUM})${SPACE}*\\b(${codes})\\b)`,
      'gi'
    );
  }

  const FRACTION = /^(\d+)?[\s\u00a0]*(\d+)\s*\/\s*(\d+)$/;

  // "1,299.00" -> 1299, "1.299,00" -> 1299, "1 299" -> 1299, "25 1/2" -> 25.5.
  // hint is a currency code; it only breaks the genuinely ambiguous "1.299" case.
  function parseNumber(raw, hint) {
    const vulgar = String(raw).trim().match(VULGAR_RE);
    if (vulgar) return Number(vulgar[1] || 0) + VULGAR[vulgar[2]];

    const frac = String(raw).trim().match(FRACTION);
    if (frac) {
      const denom = Number(frac[3]);
      if (!denom) return null;
      return Number(frac[1] || 0) + Number(frac[2]) / denom;
    }
    let s = String(raw).replace(/[    \s]/g, '');
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    let decimal = null;

    if (lastComma !== -1 && lastDot !== -1) {
      decimal = lastComma > lastDot ? ',' : '.';
    } else if (lastComma !== -1 || lastDot !== -1) {
      const sep = lastComma !== -1 ? ',' : '.';
      const idx = lastComma !== -1 ? lastComma : lastDot;
      const tail = s.length - idx - 1;
      const count = s.split(sep).length - 1;
      if (count > 1) decimal = null; // 1.234.567 — all grouping
      else if (tail === 3) {
        // 1,234 or 1.234: grouping in most of the world, decimal in a few.
        const commaDecimalLocale = hint && UB.COMMA_DECIMAL.has(hint);
        decimal = sep === '.' && commaDecimalLocale ? null : sep === ',' && !commaDecimalLocale ? null : null;
      } else decimal = sep;
    }

    if (decimal === ',') s = s.replace(/\./g, '').replace(',', '.');
    else if (decimal === '.') s = s.replace(/,/g, '');
    else s = s.replace(/[.,]/g, ''); // every separator was grouping

    const n = Number(s.replace(/[^\d.]/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  function resolveSymbol(sym, settings) {
    const key = sym.trim();
    if (UB.SYMBOLS[key]) return UB.SYMBOLS[key];
    const lower = key.toLowerCase();
    const found = Object.keys(UB.SYMBOLS).find((k) => k.toLowerCase() === lower);
    if (found) return UB.SYMBOLS[found];
    if (key === '$') return settings.dollarMeans || 'USD';
    if (key === '¥') return settings.yenMeans || 'JPY';
    if (lower === 'kr') return settings.kronaMeans || 'SEK';
    return null;
  }

  function push(out, m) {
    // Keep the first (longest-priority) match for any overlapping span.
    for (const e of out) if (m.start < e.end && e.start < m.end) return;
    out.push(m);
  }

  function findMatches(text, settings) {
    if (!MONEY_PRE) buildMoneyRegexes();
    const out = [];
    let m;

    FEET_INCHES.lastIndex = 0;
    while ((m = FEET_INCHES.exec(text))) {
      const ft = parseNumber(m[1]);
      const inch = parseNumber(m[2]);
      if (ft == null || inch == null) continue;
      push(out, {
        kind: 'length',
        start: m.index,
        end: m.index + m[0].length,
        text: m[0],
        mm: ft * 304.8 + inch * 25.4,
        unit: 'ftin',
      });
    }

    METRE_CM.lastIndex = 0;
    while ((m = METRE_CM.exec(text))) {
      const metres = Number(m[1]);
      const cm = Number(m[2].length === 1 ? m[2] + '0' : m[2]); // 1m8 means 1m80
      push(out, {
        kind: 'length',
        start: m.index,
        end: m.index + m[0].length,
        text: m[0],
        mm: metres * 1000 + cm * 10,
        unit: 'm',
      });
    }

    LENGTH.lastIndex = 0;
    while ((m = LENGTH.exec(text))) {
      if (m[2] === 'M') continue; // "5 M in seed funding" is not 5 metres
      const unit = m[2].toLowerCase();
      if (unit === 'in' && IN_IS_PROSE.test(text.slice(m.index + m[0].length))) continue;
      const factor = LENGTH_UNITS[unit] ?? LENGTH_UNITS[m[2]];
      const value = parseNumber(m[1]);
      if (!factor || value == null || value === 0) continue;
      push(out, {
        kind: 'length',
        start: m.index,
        end: m.index + m[0].length,
        text: m[0],
        mm: value * factor,
        unit: normalizeLengthUnit(unit),
        value,
      });
    }

    MONEY_PRE.lastIndex = 0;
    while ((m = MONEY_PRE.exec(text))) {
      const code = resolveSymbol(m[1], settings);
      const value = parseNumber(m[2], code);
      if (!code || !value) continue; // a zero price converts to zero
      push(out, { kind: 'money', start: m.index, end: m.index + m[0].length, text: m[0], code, value });
    }

    MONEY_POST.lastIndex = 0;
    while ((m = MONEY_POST.exec(text))) {
      const code = resolveSymbol(m[2], settings);
      const value = parseNumber(m[1], code);
      if (!code || !value) continue;
      push(out, { kind: 'money', start: m.index, end: m.index + m[0].length, text: m[0], code, value });
    }

    CODE_RE.lastIndex = 0;
    while ((m = CODE_RE.exec(text))) {
      const code = (m[1] || m[4] || '').toUpperCase();
      const value = parseNumber(m[2] || m[3], code);
      if (!UB.CURRENCIES[code] || !value) continue;
      push(out, { kind: 'money', start: m.index, end: m.index + m[0].length, text: m[0], code, value });
    }

    // "€65.00EUR" — the code repeats what the symbol already said. Absorb it so
    // the conversion can be placed after the whole price, not inside it.
    for (const m of out) {
      if (m.kind !== 'money') continue;
      const trail = text.slice(m.end).match(/^\s?([A-Za-z]{3})\b/);
      if (trail && trail[1].toUpperCase() === m.code) {
        m.end += trail[0].length;
        m.text = text.slice(m.start, m.end);
      }
    }

    return out.sort((a, b) => a.start - b.start);
  }

  function normalizeLengthUnit(unit) {
    const f = LENGTH_UNITS[unit];
    if (f === 1) return 'mm';
    if (f === 10) return 'cm';
    if (f === 1000) return 'm';
    if (f === 25.4) return 'in';
    return 'ft';
  }

  UB.detect = { findMatches, parseNumber, LENGTH_UNITS, normalizeLengthUnit, FRACTION, VULGAR, VULGAR_CLASS };
})(typeof self !== 'undefined' ? self : globalThis);

// Finds prices and measurements inside a plain string. Pure functions, no DOM —
// so the same code runs in the content script and in test/ scripts under node.
(function (root) {
  const UB = (root.UB = root.UB || {});

  const SPACE = '[ \\u00a0\\u202f\\u2009\\u2007]'; // space, nbsp, narrow/thin nbsp
  // A number with optional grouping and decimals: 1299, 1,299.00, 1.299,00, 1 299,00
  const NUM = `\\d{1,3}(?:[.,\\u00a0\\u202f\\u2009 ]\\d{3})*(?:[.,]\\d{1,4})?|\\d+(?:[.,]\\d{1,4})?`;

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

  function esc(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // 5'10" / 5 ft 10 in — one measurement written as two numbers.
  const FEET_INCHES = new RegExp(
    `(?<![\\w.,])(\\d{1,2})${SPACE}*(?:'|’|′|ft\\.?|feet|foot)${SPACE}*(\\d{1,2}(?:[.,]\\d{1,2})?)${SPACE}*(?:"|”|″|in\\.?|inch(?:es)?)(?![\\w])`,
    'gi'
  );
  const LENGTH = new RegExp(
    `(?<![\\w.,$€£¥₹])(${NUM})${SPACE}*(${LENGTH_ALT})(?![\\w])`,
    'gi'
  );

  // Built once, then reused: symbol-before-number and number-before-symbol.
  let MONEY_PRE = null;
  let MONEY_POST = null;
  let CODE_RE = null;

  function buildMoneyRegexes() {
    const symbols = Object.keys(UB.SYMBOLS)
      .concat(Object.keys(UB.AMBIGUOUS))
      .sort((a, b) => b.length - a.length)
      .map(esc)
      .join('|');
    MONEY_PRE = new RegExp(`(${symbols})${SPACE}*(${NUM})(?![\\d])`, 'gi');
    MONEY_POST = new RegExp(`(?<![\\w.,])(${NUM})${SPACE}*(${symbols})(?![\\w])`, 'gi');
    const codes = Object.keys(UB.CURRENCIES).join('|');
    CODE_RE = new RegExp(
      `(?:\\b(${codes})${SPACE}*(${NUM})(?![\\d])|(?<![\\w.,])(${NUM})${SPACE}*\\b(${codes})\\b)`,
      'gi'
    );
  }

  // "1,299.00" -> 1299, "1.299,00" -> 1299, "1 299" -> 1299.
  // hint is a currency code; it only breaks the genuinely ambiguous "1.299" case.
  function parseNumber(raw, hint) {
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

    LENGTH.lastIndex = 0;
    while ((m = LENGTH.exec(text))) {
      if (m[2] === 'M') continue; // "5 M in seed funding" is not 5 metres
      const unit = m[2].toLowerCase();
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
      if (!code || value == null) continue;
      push(out, { kind: 'money', start: m.index, end: m.index + m[0].length, text: m[0], code, value });
    }

    MONEY_POST.lastIndex = 0;
    while ((m = MONEY_POST.exec(text))) {
      const code = resolveSymbol(m[2], settings);
      const value = parseNumber(m[1], code);
      if (!code || value == null) continue;
      push(out, { kind: 'money', start: m.index, end: m.index + m[0].length, text: m[0], code, value });
    }

    CODE_RE.lastIndex = 0;
    while ((m = CODE_RE.exec(text))) {
      const code = (m[1] || m[4] || '').toUpperCase();
      const value = parseNumber(m[2] || m[3], code);
      if (!UB.CURRENCIES[code] || value == null) continue;
      push(out, { kind: 'money', start: m.index, end: m.index + m[0].length, text: m[0], code, value });
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

  UB.detect = { findMatches, parseNumber, LENGTH_UNITS, normalizeLengthUnit };
})(typeof self !== 'undefined' ? self : globalThis);

// Turns a detected match plus the current settings into the two lines of text
// the bubble shows: the converted value, and the original for reference.
(function (root) {
  const UB = (root.UB = root.UB || {});

  const num = (n, max) =>
    new Intl.NumberFormat(undefined, { maximumFractionDigits: max, minimumFractionDigits: 0 }).format(n);

  function money(value, code) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: code,
        maximumFractionDigits: UB.ZERO_DECIMAL.has(code) ? 0 : 2,
      }).format(value);
    } catch {
      return `${num(value, 2)} ${code}`;
    }
  }

  function length(mm, unit) {
    switch (unit) {
      case 'mm': return `${num(mm, 1)} mm`;
      case 'cm': return `${num(mm / 10, 1)} cm`;
      case 'm': return `${num(mm / 1000, 2)} m`;
      case 'in': return `${num(mm / 25.4, 2)} in`;
      case 'ft': return `${num(mm / 304.8, 2)} ft`;
      case 'ftin': {
        const totalIn = mm / 25.4;
        const ft = Math.floor(totalIn / 12);
        const inch = totalIn - ft * 12;
        return `${ft}′ ${num(inch, 1)}″`;
      }
      default: return `${num(mm, 1)} mm`;
    }
  }

  // Pick a readable unit on the target side: nobody wants 0.39 in or 2400 cm.
  function targetUnit(mm, want) {
    // Garment sizes read better in plain inches; only go to feet past 3 ft.
    if (want === 'in') return mm / 25.4 >= 36 ? 'ftin' : 'in';
    if (mm >= 1000) return 'm';
    if (mm < 10) return 'mm';
    return 'cm';
  }

  // Both values reduced to a canonical form, to skip no-op conversions
  // (hovering "12 in" when you already read in inches).
  function sameSide(unit, want) {
    const imperial = unit === 'in' || unit === 'ft' || unit === 'ftin';
    return (want === 'in') === imperial;
  }

  function convert(match, settings, rates) {
    if (match.kind === 'length') {
      if (sameSide(match.unit, settings.length)) return null;
      const unit = targetUnit(match.mm, settings.length);
      return {
        primary: length(match.mm, unit),
        original: length(match.mm, match.unit),
        note: null,
      };
    }

    const to = settings.currency || 'USD';
    if (match.code === to) return null;
    const from = rates && rates[match.code];
    const into = rates && rates[to];
    if (!from || !into) return { primary: null, original: money(match.value, match.code), note: `No rate for ${match.code}` };

    const rate = into / from;
    const converted = match.value * rate;
    return {
      primary: money(converted, to),
      original: money(match.value, match.code),
      note: `1 ${match.code} = ${num(rate, rate < 1 ? 4 : rate < 100 ? 3 : 2)} ${to}`,
    };
  }

  UB.convert = convert;
  UB.format = { money, length, num };
})(typeof self !== 'undefined' ? self : globalThis);

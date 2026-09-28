// Size-chart reader.
//
// Sites render size charts as tables, CSS grids, flex columns, absolutely
// positioned divs, or inline SVG — and on Shopify the chart is usually injected
// by an app, so the markup can't be known ahead of time. So this doesn't read
// markup at all: it takes the numbers with their on-screen rectangles and
// clusters them back into a grid.
//
// It also handles the two things that make a chart unreadable by unit detection
// alone: charts written transposed (sizes across the top), and charts whose
// cells are bare numbers with the unit stated once in a heading, or not at all.
// Everything here is pure geometry and arithmetic, so it is testable without a
// browser.
(function (root) {
  const UB = (root.UB = root.UB || {});

  const MIN_FILL = 0.55;
  const MIN_ORDER = 0.6; // share of lines that must run in one direction

  const mid = (a, b) => (a + b) / 2;
  const median = (xs) => {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };

  /* ---------- cells ---------- */

  // A chart cell is a number, optionally fractional, optionally carrying its
  // own unit: "47cm", "25 1/2", "23", '22 3/4"'.
  const CELL = new RegExp(
    '^[\\s\\u00a0]*(\\d+[\\s\\u00a0]+\\d+\\s*/\\s*\\d+|\\d+\\s*/\\s*\\d+|\\d+(?:[.,]\\d+)?)' +
      '[\\s\\u00a0]*(cm|mm|m|in|inch|inches|"|”|″|ft|feet|foot|\'|’|′)?[\\s\\u00a0]*$',
    'i'
  );

  function parseCell(text) {
    const m = String(text).match(CELL);
    if (!m) return null;
    const value = UB.detect.parseNumber(m[1]);
    if (value == null || value <= 0 || value > 100000) return null;
    const raw = m[2] ? m[2].toLowerCase() : null;
    const factor = raw ? UB.detect.LENGTH_UNITS[raw] : null;
    return {
      value,
      unit: factor ? UB.detect.normalizeLengthUnit(raw) : null,
      mm: factor ? value * factor : null,
    };
  }

  /* ---------- clustering ---------- */

  function clusterRows(items) {
    const rows = [];
    for (const item of [...items].sort((a, b) => a.rect.top - b.rect.top)) {
      const h = item.rect.bottom - item.rect.top || 12;
      const c = mid(item.rect.top, item.rect.bottom);
      const row = rows.find((r) => Math.abs(r.center - c) <= Math.max(h * 0.7, 6));
      if (row) {
        row.items.push(item);
        row.center = (row.center * (row.items.length - 1) + c) / row.items.length;
        row.top = Math.min(row.top, item.rect.top);
        row.bottom = Math.max(row.bottom, item.rect.bottom);
      } else {
        rows.push({ center: c, top: item.rect.top, bottom: item.rect.bottom, items: [item] });
      }
    }
    return rows.sort((a, b) => a.center - b.center);
  }

  function clusterCols(items) {
    const w = median(items.map((i) => i.rect.right - i.rect.left)) || 30;
    const tol = Math.max(w * 1.1, 18);
    const cols = [];
    for (const item of [...items].sort(
      (a, b) => mid(a.rect.left, a.rect.right) - mid(b.rect.left, b.rect.right)
    )) {
      const c = mid(item.rect.left, item.rect.right);
      const col = cols.find((k) => Math.abs(k.center - c) <= tol);
      if (col) {
        col.n += 1;
        col.center = (col.center * (col.n - 1) + c) / col.n;
        col.left = Math.min(col.left, item.rect.left);
        col.right = Math.max(col.right, item.rect.right);
      } else {
        cols.push({ center: c, left: item.rect.left, right: item.rect.right, n: 1 });
      }
    }
    return cols.sort((a, b) => a.center - b.center);
  }

  // Share of lines that never change direction. Ties count as ordered, so a
  // column that repeats a value still passes. This is what separates a size
  // chart from any other grid of numbers: its measurements grow with the sizes.
  function orderedShare(lines) {
    let ordered = 0;
    let counted = 0;
    for (const line of lines) {
      const vals = line.filter(Boolean).map((i) => i.value);
      if (vals.length < 3) continue;
      counted += 1;
      const up = vals.every((v, i) => i === 0 || v >= vals[i - 1]);
      const down = vals.every((v, i) => i === 0 || v <= vals[i - 1]);
      if (up || down) ordered += 1;
    }
    return counted ? ordered / counted : 0;
  }

  const columnsOf = (cells) => (cells[0] || []).map((_, c) => cells.map((row) => row[c]));

  function buildGrid(items) {
    if (items.length < 6) return null;
    const rowBands = clusterRows(items);
    const colBands = clusterCols(items);
    const R = rowBands.length;
    const C = colBands.length;
    // Either orientation: at least 3 sizes and 2 measurements.
    if (!((R >= 3 && C >= 2) || (R >= 2 && C >= 3))) return null;

    const cells = rowBands.map(() => new Array(C).fill(null));
    let filled = 0;
    rowBands.forEach((row, r) => {
      for (const item of row.items) {
        const c = mid(item.rect.left, item.rect.right);
        let best = 0;
        let bestD = Infinity;
        colBands.forEach((col, i) => {
          const d = Math.abs(col.center - c);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        });
        if (!cells[r][best]) {
          cells[r][best] = item;
          filled += 1;
        }
      }
    });
    if (filled / (R * C) < MIN_FILL) return null;

    const units = new Set(items.map((i) => i.unit).filter(Boolean));
    if (units.size > 2) return null;

    // A chart read down the columns has sizes as rows; one read across the rows
    // is transposed, with sizes along the top.
    const down = orderedShare(columnsOf(cells));
    const across = orderedShare(cells);
    if (Math.max(down, across) < MIN_ORDER) return null;

    return {
      cells,
      rowBands,
      colBands,
      filled,
      slots: R * C,
      ordered: Math.max(down, across),
      down,
      across,
      transposed: across > down,
    };
  }

  /* ---------- labels ---------- */

  function clean(text) {
    return String(text).replace(/\s+/g, ' ').replace(/[:•·]+$/, '').trim().slice(0, 28);
  }

  // Headers sit above the first row of values, size labels left of the first
  // column. Both are picked by alignment, never by tag name. Both sets are
  // always collected, because which one names the sizes depends on orientation.
  function attachLabels(grid, labels) {
    const firstRow = grid.rowBands[0];
    const firstCol = grid.colBands[0];

    grid.topLabels = grid.colBands.map((col) => {
      const band = Math.max((col.right - col.left) * 0.9, 30);
      let best = null;
      for (const l of labels) {
        const c = mid(l.rect.left, l.rect.right);
        if (Math.abs(c - col.center) > band) continue;
        if (l.rect.bottom > firstRow.top + 2) continue;
        if (!best || l.rect.bottom > best.rect.bottom) best = l;
      }
      return best ? clean(best.text) : '';
    });

    grid.leftLabels = grid.rowBands.map((row) => {
      let best = null;
      for (const l of labels) {
        const c = mid(l.rect.top, l.rect.bottom);
        if (c < row.top - 4 || c > row.bottom + 4) continue;
        if (l.rect.right > firstCol.left + 4) continue;
        if (!best || l.rect.right > best.rect.right) best = l;
      }
      return best ? clean(best.text) : '';
    });

    return grid;
  }

  const transpose = (cells) => (cells[0] || []).map((_, c) => cells.map((row) => row[c]));

  // After this, cells are always [size][measurement], headers name the
  // measurements and rowLabels name the sizes — whichever way the page wrote it.
  function orient(grid) {
    if (grid.transposed) {
      grid.cells = transpose(grid.cells);
      grid.headers = grid.leftLabels || [];
      grid.rowLabels = grid.topLabels || [];
    } else {
      grid.headers = grid.topLabels || [];
      grid.rowLabels = grid.leftLabels || [];
    }
    return grid;
  }

  const SIZE_LABEL = /^(?:xx?x?s|s|m|l|xx?x?l|[2-6]x?l|one ?size|os|t?\d{1,3}(?:[.,]\d)?|\d{2}[-/]\d{2}|w\d{2})$/i;

  function looksLikeSizes(labels = []) {
    const named = labels.filter((l) => l);
    if (named.length < 2) return false;
    return named.filter((l) => SIZE_LABEL.test(l.replace(/\s+/g, ''))).length / named.length >= 0.6;
  }

  function looksLikeMeasurements(labels = []) {
    const named = labels.filter((l) => l);
    if (!named.length) return false;
    return named.filter((l) => columnRole(l)).length / named.length >= 0.5;
  }

  /* ---------- units ---------- */

  // A chart whose cells carry no unit states it once in a heading, or leaves it
  // implied. Text first, then magnitude: garment charts in inches sit well
  // under 40, in centimetres well over it. If it lands in between, give up
  // rather than guess — a wrong unit is worse than no panel.
  function inferUnit(items, scopeText = '') {
    const withUnit = items.filter((i) => i.unit);
    if (withUnit.length >= items.length / 2) {
      const counts = {};
      for (const i of withUnit) counts[i.unit] = (counts[i.unit] || 0) + 1;
      return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    }
    if (/\b(?:inch|inches|in\.)\b|["”″]/.test(scopeText)) return 'in';
    if (/\b(?:cm|centimet\w*|centimètres?)\b/i.test(scopeText)) return 'cm';
    if (/\b(?:mm|millimet\w*)\b/i.test(scopeText)) return 'mm';
    const med = median(items.map((i) => i.value));
    if (med >= 45) return 'cm';
    if (med <= 35) return 'in';
    return null;
  }

  function applyUnit(items, unit) {
    const factor = UB.detect.LENGTH_UNITS[unit];
    if (!factor) return false;
    for (const item of items) {
      if (item.mm == null) {
        item.mm = item.value * factor;
        item.unit = unit;
      }
    }
    return true;
  }

  /* ---------- measurement roles ---------- */

  const ROLES = [
    ['chest', /chest|bust|poitrine|brust|pecho|petto|torace|bröst/i],
    ['shoulders', /shoulder|épaule|epaule|schulter|hombro|spalle|axel/i],
    ['waist', /waist|taille|bund|cintura|vita|midja/i],
    ['hips', /hip|seat|hanche|hüfte|cadera|fianchi/i],
    ['sleeve', /sleeve|manche|ärmel|manga|manica/i],
    ['inseam', /inseam|inside leg|entrejambe|schritt/i],
    ['neck', /neck|collar|kragen|cuello|colletto|encolure/i],
    ['thigh', /thigh|cuisse|oberschenkel|muslo|coscia/i],
    ['rise', /rise|montant|schritthöhe|tiro/i],
    ['legOpening', /leg opening|hem width|cuff|opening|bas de jambe|ourlet/i],
    ['length', /length|back|body|longueur|länge|largo|lunghezza|hem/i],
  ];

  function columnRole(header) {
    for (const [role, re] of ROLES) if (re.test(header || '')) return role;
    return null;
  }

  // Smallest size whose value for that column is at least the wearer's own
  // measurement — how you actually read a flat-measurement chart.
  function pickSize(grid, measurements, priority) {
    if (!grid || !measurements) return null;
    const roles = (grid.headers || []).map(columnRole);
    for (const role of priority && priority.length ? priority : ['chest', 'shoulders', 'waist', 'hips']) {
      const col = roles.indexOf(role);
      const want = measurements[role];
      if (col === -1 || !want) continue;
      const column = grid.cells.map((row) => row[col]);
      for (let r = 0; r < column.length; r++) {
        if (column[r] && column[r].mm >= want) {
          return { row: r, col, role, label: grid.rowLabels[r] || `row ${r + 1}`, wantMm: want };
        }
      }
      const last = column.map((c, i) => (c ? i : -1)).filter((i) => i >= 0).pop();
      if (last != null) return { row: last, col, role, label: grid.rowLabels[last], wantMm: want, over: true };
    }
    return null;
  }

  // The link or button a store puts on a product page to open its size guide.
  // Matched on its own text, in the languages the rest of this file covers.
  const TRIGGER = new RegExp(
    '^\\s*(?:' +
      'size\\s*(?:guide|chart|conversion|info|table)|' +
      '(?:size|sizing)\\s*(?:&|and)\\s*fit|fit\\s*guide|sizing|size\\s*help|' +
      'measurements?|garment\\s*measurements|' +
      'guide\\s*des\\s*tailles|tableau\\s*des\\s*tailles|' +
      'gr(?:ö|oe|o)(?:ß|ss)entabelle|gr(?:ö|oe|o)(?:ß|ss)en|' +
      'gu(?:í|i)a\\s*de\\s*tallas|tabla\\s*de\\s*tallas|' +
      'tabella\\s*(?:delle\\s*)?taglie|' +
      'storleksguide|maattabel' +
    ')\\s*[:>»→]?\\s*$',
    'i'
  );

  function looksLikeTrigger(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length > 0 && t.length <= 40 && TRIGGER.test(t);
  }

  UB.chart = {
    parseCell,
    looksLikeTrigger,
    TRIGGER,
    buildGrid,
    attachLabels,
    orient,
    transpose,
    looksLikeSizes,
    looksLikeMeasurements,
    inferUnit,
    applyUnit,
    columnRole,
    pickSize,
    clean,
    orderedShare,
    CELL,
  };
})(typeof self !== 'undefined' ? self : globalThis);

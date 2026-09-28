// Size-chart reader.
//
// Sites render size charts as tables, CSS grids, flex rows, or absolutely
// positioned divs — and on Shopify the chart is usually injected by an app, so
// the markup can't be known ahead of time. So this doesn't read markup at all:
// it takes the measurement values with their on-screen rectangles and clusters
// them back into a grid. Everything here is pure geometry, which also means it
// is testable without a browser.
(function (root) {
  const UB = (root.UB = root.UB || {});

  const MIN_ROWS = 3;
  const MIN_COLS = 2;
  const MIN_FILL = 0.55; // share of grid slots that must hold a value

  const mid = (a, b) => (a + b) / 2;
  const median = (xs) => {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };

  // Group values whose rects share a horizontal band.
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

  // Group the same values into vertical bands. Tolerance comes from how wide the
  // values themselves are, so it scales with the page's font size.
  function clusterCols(items) {
    const w = median(items.map((i) => i.rect.right - i.rect.left)) || 30;
    const tol = Math.max(w * 1.1, 18);
    const cols = [];
    for (const item of [...items].sort((a, b) => mid(a.rect.left, a.rect.right) - mid(b.rect.left, b.rect.right))) {
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

  // Share of columns that never change direction. Ties count as ordered, so a
  // column that repeats a value (common for sleeves) still passes.
  function monotonicShare(cells, colCount) {
    let ordered = 0;
    for (let c = 0; c < colCount; c++) {
      const col = cells.map((row) => row[c]).filter(Boolean).map((i) => i.mm);
      if (col.length < 3) continue;
      const up = col.every((v, i) => i === 0 || v >= col[i - 1]);
      const down = col.every((v, i) => i === 0 || v <= col[i - 1]);
      if (up || down) ordered += 1;
    }
    return colCount ? ordered / colCount : 0;
  }

  function buildGrid(items) {
    if (items.length < MIN_ROWS * MIN_COLS) return null;
    const rowBands = clusterRows(items);
    const colBands = clusterCols(items);
    if (rowBands.length < MIN_ROWS || colBands.length < MIN_COLS) return null;

    const cells = rowBands.map(() => new Array(colBands.length).fill(null));
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

    const slots = rowBands.length * colBands.length;
    if (filled / slots < MIN_FILL) return null;

    // A chart column is one unit throughout; bail if it looks like prose.
    const units = new Set(items.map((i) => i.unit));
    if (units.size > 2) return null;

    // The real separator between a size chart and any other grid of numbers
    // (a row of product cards, a spec grid): every column of a size chart
    // climbs, or falls, as you go down the sizes. Scattered measurements don't.
    const monotonic = monotonicShare(cells, colBands.length);
    if (monotonic < 0.6) return null;

    return { cells, rowBands, colBands, filled, slots, monotonic };
  }

  // Headers sit above the first row of values; size labels sit left of the first
  // column. Both are picked by alignment, not by tag name.
  function attachLabels(grid, labels) {
    const firstRow = grid.rowBands[0];
    const firstCol = grid.colBands[0];

    grid.headers = grid.colBands.map((col) => {
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

    grid.rowLabels = grid.rowBands.map((row) => {
      let best = null;
      for (const l of labels) {
        const c = mid(l.rect.top, l.rect.bottom);
        if (c < row.top - 4 || c > row.bottom + 4) continue;
        if (l.rect.right > firstCol.left + 4) continue;
        if (!best || l.rect.right > best.rect.right) best = l;
      }
      return best ? clean(best.text) : '';
    });

    // Drop a leading label column header like "Size" from the value headers.
    return grid;
  }

  function clean(text) {
    return String(text).replace(/\s+/g, ' ').replace(/[:•·]+$/, '').trim().slice(0, 28);
  }

  // Which body measurement a column is about, so a saved measurement can be
  // matched to the right column. Covers the languages I actually shop in.
  const ROLES = [
    ['chest', /chest|bust|poitrine|brust|pecho|petto|torace|bröst/i],
    ['shoulders', /shoulder|épaule|epaule|schulter|hombro|spalle|axel/i],
    ['waist', /waist|taille|bund|cintura|vita|midja/i],
    ['hips', /hip|hanche|hüfte|cadera|fianchi/i],
    ['length', /length|back|longueur|länge|largo|lunghezza|hem/i],
    ['sleeve', /sleeve|manche|ärmel|manga|manica/i],
    ['inseam', /inseam|inside leg|entrejambe|schritt/i],
  ];

  function columnRole(header) {
    for (const [role, re] of ROLES) if (re.test(header || '')) return role;
    return null;
  }

  // Smallest row whose value for that column is at least the wearer's own
  // measurement — how you actually pick a size off a flat-measurement chart.
  function pickSize(grid, measurements) {
    if (!grid || !measurements) return null;
    const roles = (grid.headers || []).map(columnRole);
    for (const role of ['chest', 'shoulders', 'waist', 'hips']) {
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

  UB.chart = { buildGrid, attachLabels, columnRole, pickSize, clean, MIN_ROWS, MIN_COLS };
})(typeof self !== 'undefined' ? self : globalThis);

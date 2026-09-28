// Walks visible text, marks every price and measurement with an inline chip
// holding the converted value, and hands any size chart it finds to the panel.
// The chip flows with the text (so it can never cover page content); the hover
// bubble is still there as the detail layer, carrying the original and the rate.
(function () {
  const UB = window.UB;
  if (!UB || window.__ubLoaded) return;
  window.__ubLoaded = true;

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
    'IFRAME', 'CANVAS', 'SVG', 'MATH', 'TEMPLATE', 'HEAD', 'TITLE', 'CODE', 'PRE',
  ]);
  const MAX_NODES_PER_PASS = 1200;
  // Marks per slice. A catalogue page with 300 products wants 1200 chips, and
  // doing them in one go produced a single 55ms task — right at the threshold
  // where a browser calls it a long task. Slices keep every one of them short.
  const MARK_BUDGET = 220;
  const MIN_CHART_HITS = UB.chart.MIN_ROWS * UB.chart.MIN_COLS;

  let settings = { ...UB.DEFAULT_SETTINGS };
  let rates = { ...UB.FALLBACK_RATES };
  let ratesFetchedAt = 0;
  let active = false;
  let seen = new WeakSet();

  /* ---------- hover bubble (detail layer) ---------- */

  let bubbleHost = null;
  let bubble = null;
  let hideTimer = null;
  let hovered = null;

  const BUBBLE_CSS = `
    :host { all: initial; }
    .b {
      position: fixed; z-index: 2147483647; pointer-events: none;
      box-sizing: border-box; max-width: 260px; padding: 7px 10px 8px; border-radius: 10px;
      font: 400 12.5px/1.4 'FerrariSans', -apple-system, system-ui, sans-serif;
      background: rgba(255,255,255,.88); color: #0b0b0c;
      -webkit-backdrop-filter: saturate(180%) blur(14px); backdrop-filter: saturate(180%) blur(14px);
      border: 1px solid rgba(0,0,0,.08);
      box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 8px 24px -6px rgba(0,0,0,.22);
      opacity: 0; transform: translateY(3px); transition: opacity .12s ease, transform .14s cubic-bezier(.2,.8,.2,1);
    }
    .b.in { opacity: 1; transform: none; }
    .v { font-size: 15px; font-weight: 500; letter-spacing: -.01em; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .o { margin-top: 2px; font-size: 11.5px; color: rgba(0,0,0,.45); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .n { margin-top: 4px; font-size: 10.5px; color: #007aff; white-space: nowrap; }
    .stale { color: #a2600b; }
    @media (prefers-color-scheme: dark) {
      .b { background: rgba(28,28,30,.86); color: #f5f5f7; border-color: rgba(255,255,255,.1);
           box-shadow: 0 1px 2px rgba(0,0,0,.4), 0 10px 28px -6px rgba(0,0,0,.6); }
      .o { color: rgba(255,255,255,.5); } .n { color: #4da2ff; } .stale { color: #f0b76b; }
    }
    @media (prefers-reduced-motion: reduce) { .b { transition: none; } }
  `;

  function ensureBubble() {
    if (bubble) return bubble;
    bubbleHost = document.createElement('div');
    bubbleHost.setAttribute('data-ub-root', '');
    bubbleHost.style.cssText = 'all:initial;position:static';
    const shadow = bubbleHost.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = BUBBLE_CSS;
    bubble = document.createElement('div');
    bubble.className = 'b';
    bubble.innerHTML = '<div class="v"></div><div class="o"></div><div class="n"></div>';
    shadow.append(style, bubble);
    (document.body || document.documentElement).appendChild(bubbleHost);
    return bubble;
  }

  function showBubble(target, conv) {
    const b = ensureBubble();
    const stale = ratesFetchedAt && Date.now() - ratesFetchedAt > 36 * 3600 * 1000;
    b.querySelector('.v').textContent = conv.primary || conv.original;
    const o = b.querySelector('.o');
    o.textContent = conv.primary ? conv.original : '';
    o.hidden = !conv.primary;
    const n = b.querySelector('.n');
    const note = conv.note ? (stale ? `${conv.note} · rate is stale` : conv.note) : '';
    n.textContent = note;
    n.hidden = !note;
    n.className = 'n' + (stale ? ' stale' : '');

    b.style.visibility = 'hidden';
    b.classList.add('in');
    const r = originalRect(target) || target.getBoundingClientRect();
    const bw = b.offsetWidth;
    const bh = b.offsetHeight;
    let top = r.top - bh - 8;
    if (top < 6) top = Math.min(r.bottom + 8, window.innerHeight - bh - 6);
    let left = Math.max(6, Math.min(r.left + r.width / 2 - bw / 2, window.innerWidth - bw - 6));
    b.style.top = `${Math.round(top)}px`;
    b.style.left = `${Math.round(left)}px`;
    b.style.visibility = 'visible';
    hovered = target;
  }

  function hideBubble() {
    if (bubble) bubble.classList.remove('in');
    hovered = null;
  }

  function onOver(e) {
    const hit = e.target instanceof Element ? e.target.closest('.ub-hit') : null;
    if (!hit) return;
    clearTimeout(hideTimer);
    if (hit === hovered) return;
    const data = readMatch(hit);
    if (!data) return;
    const conv = UB.convert(data, settings, rates);
    if (conv) showBubble(hit, conv);
  }

  function onOut(e) {
    if (!(e.target instanceof Element) || !e.target.closest('.ub-hit')) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideBubble, 90);
  }

  /* ---------- marking ---------- */

  function readMatch(hit) {
    try {
      return JSON.parse(hit.dataset.ub);
    } catch {
      return null;
    }
  }

  // The rect of the original value only — the chip is excluded, so column
  // geometry in a chart isn't skewed by how wide the conversion happens to be.
  function originalRect(hit) {
    const node = hit.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) return null;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    return rect.width || rect.height ? rect : null;
  }

  function skip(node) {
    const parent = node.parentElement;
    if (!parent) return true;
    if (SKIP_TAGS.has(parent.tagName)) return true;
    // ownerSVGElement is set on every element inside an <svg>; tagName checks
    // miss it because SVG tag names are lowercase.
    if (parent.ownerSVGElement || parent.tagName === 'svg') return true;
    return !!parent.closest(
      '[data-ub-root],[data-ub-chart],[contenteditable=""],[contenteditable="true"],.ub-hit'
    );
  }

  function collect(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (seen.has(node)) return NodeFilter.FILTER_REJECT;
        const text = node.nodeValue;
        if (!text || text.length < 2 || !/\d/.test(text)) return NodeFilter.FILTER_REJECT;
        return skip(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (nodes.length < MAX_NODES_PER_PASS && walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  const deferred = [];
  const deferredSet = new WeakSet();

  function mark(node, force) {
    const whole = node.nodeValue.trim();
    // A text node that is nothing but one measurement is what a chart cell
    // looks like. Marking it immediately meant chips flashed across a chart and
    // then vanished when the panel took over, so it waits one detection pass.
    if (!force && whole.length <= 20 && UB.chart.parseCell(whole)) {
      if (!deferredSet.has(node)) {
        deferredSet.add(node);
        deferred.push(node);
      }
      return 0;
    }
    seen.add(node);
    const text = node.nodeValue;
    const usable = UB.detect
      .findMatches(text, settings)
      .filter((m) => (m.kind === 'money' ? settings.chipPrices !== false : settings.chipMeasurements !== false))
      .map((m) => ({ m, conv: UB.convert(m, settings, rates) }))
      .filter((x) => x.conv && x.conv.primary);
    if (!usable.length) return 0;

    const frag = document.createDocumentFragment();
    let cursor = 0;
    for (const { m, conv } of usable) {
      if (m.start > cursor) frag.append(document.createTextNode(text.slice(cursor, m.start)));
      const hit = document.createElement('span');
      hit.className = 'ub-hit';
      hit.dataset.ub = JSON.stringify(m);
      hit.dataset.ubKind = m.kind;
      hit.append(document.createTextNode(text.slice(m.start, m.end)));
      const chip = document.createElement('span');
      chip.className = 'ub-chip';
      chip.textContent = conv.primary;
      hit.append(chip);
      frag.append(hit);
      if (m.kind === 'money') pendingCodeFix.push([hit, m.code]);
      cursor = m.end;
    }
    if (cursor < text.length) frag.append(document.createTextNode(text.slice(cursor)));
    node.parentNode.replaceChild(frag, node);
    return usable.length;
  }

  // Some stores print the code in its own node: <span>€65.00</span><span>EUR</span>.
  // Move the chip past it so the line reads "€65.00 EUR ($74.00)".
  const pendingCodeFix = [];

  function tidyCurrencyCodes() {
    while (pendingCodeFix.length) {
      const [hit, code] = pendingCodeFix.pop();
      const chip = hit.querySelector('.ub-chip');
      if (!chip || !hit.isConnected) continue;
      const next = hit.nextSibling;
      if (!next) continue;
      if (next.nodeType === Node.TEXT_NODE) {
        const match = next.nodeValue.match(/^\s*([A-Za-z]{3})\b/);
        if (!match || match[1].toUpperCase() !== code) continue;
        next.splitText(match[0].length);
        next.after(chip);
      } else if (next.nodeType === Node.ELEMENT_NODE && next.textContent.trim().toUpperCase() === code) {
        next.after(chip);
      }
    }
  }

  // Cells that no chart claimed still deserve chips — but only once they are on
  // screen. Chipping a hidden cell means chipping a chart that has not been
  // recognised yet, and every one of those chips is stripped a moment later
  // when it is: that was the flash when a store's size guide opened.
  function flushDeferred() {
    if (!deferred.length) return;
    const nodes = deferred.splice(0, deferred.length);
    for (const node of nodes) {
      if (!node.parentElement || !node.isConnected) continue;
      if (node.parentElement.closest('[data-ub-chart],[data-ub-root]')) continue;
      if (!rangeRect(node)) {
        deferredSet.delete(node);
        deferred.push(node); // still hidden: wait for it to be shown
        deferredSet.add(node);
        continue;
      }
      try {
        mark(node, true);
      } catch {
        /* the page moved it; a later pass will catch it */
      }
    }
  }

  function unmark() {
    for (const hit of document.querySelectorAll('.ub-hit')) {
      const parent = hit.parentNode;
      if (!parent) continue;
      const original = hit.firstChild && hit.firstChild.nodeType === Node.TEXT_NODE ? hit.firstChild.nodeValue : hit.textContent;
      parent.replaceChild(document.createTextNode(original), hit);
      parent.normalize();
    }
    for (const el of document.querySelectorAll('[data-ub-chart]')) el.removeAttribute('data-ub-chart');
    for (const el of document.querySelectorAll('.ub-cta')) el.remove();
    ctaEl = null;
    ctaAnchor = null;
    ctaMode = null;
    ctaChart = null;
    hideBubble();
    UB.panel.hide();
    charts.clear();
  }

  /* ---------- size charts ---------- */

  const charts = new Map(); // container -> chart
  const MAX_CELLS = 4000;
  const CELL_SKIP = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'IFRAME', 'TEMPLATE', 'HEAD', 'TITLE',
  ]);
  let chartObserver = null;
  let visibilityWatcher = null;
  let recheckTimer = null;

  const imperial = (unit) => unit === 'in' || unit === 'ft' || unit === 'ftin';

  function rangeRect(node) {
    const range = document.createRange();
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    return rect.width || rect.height ? rect : null;
  }

  // A chart inside a closed modal or a collapsed panel is in the DOM with no
  // rectangles to cluster, and opening it flips visibility without adding any
  // text — so detection has to be re-armed by visibility, not by mutation.
  function watchForVisible(el) {
    if (!el) return;
    if (!visibilityWatcher) {
      visibilityWatcher = new IntersectionObserver((entries) => {
        let woke = false;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          visibilityWatcher.unobserve(entry.target);
          woke = true;
        }
        if (woke) queueRecheck();
      });
    }
    visibilityWatcher.observe(el);
  }

  function queueRecheck(delay = 120) {
    clearTimeout(recheckTimer);
    recheckTimer = setTimeout(() => {
      try {
        detectCharts();
      } catch (err) {
        console.warn('[Unit Bubble] chart detection failed:', err);
      }
    }, delay);
  }

  // Every short text node in the page, split into numeric cells and everything
  // else (which becomes a candidate label). SVG text is included here even
  // though it is never marked, because an SVG chart is real text with real
  // rectangles — exactly what the reader needs.
  function collectCells(root) {
    const cells = [];
    const labels = [];
    let hidden = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const text = node.nodeValue;
        if (!text || !text.trim() || text.length > 40) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent || CELL_SKIP.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (parent.classList && (parent.classList.contains('ub-chip') || parent.classList.contains('ub-cta'))) {
          return NodeFilter.FILTER_REJECT;
        }
        if (parent.closest('[data-ub-root],[data-ub-chart],.ub-cta')) return NodeFilter.FILTER_REJECT;
        // Text belonging to a control is not a column header. A store's
        // "Where are we shipping to?" select label was being read as one.
        if (parent.closest('select,option,optgroup,button,label,fieldset,legend')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (cells.length + labels.length < MAX_CELLS && walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.nodeValue.trim();
      const cell = UB.chart.parseCell(text);
      const rect = rangeRect(node);
      if (!rect) {
        if (cell) {
          hidden += 1;
          watchForVisible(node.parentElement);
        }
        continue;
      }
      if (cell) cells.push({ ...cell, rect, node });
      else if (text.length <= 28) labels.push({ text, rect, el: node.parentElement });
    }
    return { cells, labels, hidden };
  }

  // Ancestors holding enough numeric cells to be a chart, tightest first: depth
  // counts steps up from a cell, so a <tbody> must win over <body>.
  function candidates(cells) {
    const byEl = new Map();
    for (const cell of cells) {
      let el = cell.node.parentElement;
      for (let depth = 0; el && depth < 10; depth++, el = el.parentElement) {
        if (!byEl.has(el)) byEl.set(el, { el, depth, items: [] });
        byEl.get(el).items.push(cell);
      }
    }
    // Tightest first, and on a tie the one holding fewer values: a <tbody> and
    // the <main> around it can sit at the same depth, and taking the larger one
    // merged a prose sentence into the chart below it.
    return [...byEl.values()]
      .filter((c) => c.items.length >= 6)
      .sort((a, b) => a.depth - b.depth || a.items.length - b.items.length);
  }

  // Labels near the grid, by geometry rather than by DOM ancestry: a header row
  // usually sits outside the element the values live in.
  // The nearest ancestor that visually contains the chart: an overlay, a
  // dialog, or a scroll box. Labels outside it belong to whatever is behind it.
  function overlayScope(el) {
    for (let node = el.parentElement, i = 0; node && node !== document.body && i < 12; node = node.parentElement, i++) {
      if (node.tagName === 'DIALOG' || node.getAttribute('role') === 'dialog' || node.hasAttribute('aria-modal')) {
        return node;
      }
      let style;
      try {
        style = getComputedStyle(node);
      } catch {
        return null;
      }
      if (style.position === 'fixed' || style.position === 'absolute') return node;
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') return node;
    }
    return null;
  }

  function labelsNear(grid, labels, scope) {
    const top = grid.rowBands[0].top;
    const bottom = grid.rowBands[grid.rowBands.length - 1].bottom;
    const left = grid.colBands[0].left;
    const right = grid.colBands[grid.colBands.length - 1].right;
    // Generous to the left and above, because that is where labels live: a
    // symmetric window sized on the grid excluded a "Size" column sitting
    // 300px to its left. Pulling in too much is harmless — attachLabels still
    // requires a header to sit above its column and a row label to its left,
    // and `scope` keeps a modal from reading the page behind it.
    const width = right - left;
    const height = bottom - top;
    const padLeft = Math.max(width, 700);
    const padRight = Math.max(width * 0.5, 200);
    const padTop = Math.max(height * 0.5, 200);
    const padBottom = Math.max(height * 0.25, 80);
    return labels.filter(
      (l) =>
        (!scope || scope.contains(l.el)) &&
        l.rect.right > left - padLeft &&
        l.rect.left < right + padRight &&
        l.rect.bottom > top - padTop &&
        l.rect.top < bottom + padBottom
    );
  }

  function scopeText(el) {
    const parts = [el.textContent || ''];
    let prev = el.previousElementSibling;
    for (let i = 0; prev && i < 3; prev = prev.previousElementSibling, i++) parts.push(prev.textContent || '');
    if (el.parentElement) parts.push((el.parentElement.getAttribute('aria-label') || ''));
    return parts.join(' ').slice(0, 600);
  }

  function detectCharts() {
    if (!active) return;
    const T = settings.debug ? [] : null;
    const mark0 = performance.now();
    const lap = (name) => T && T.push(`${name} ${Math.round(performance.now() - mark0)}ms`);
    dropDeadCharts();
    UB.panel.keepAlive();
    // With debug on, say why each candidate was turned down. A chart that is
    // never recognised prints nothing otherwise, which is the hardest case to
    // diagnose.
    const rejected = settings.debug ? [] : null;
    const reject = (cand, why, extra) => {
      if (rejected) {
        rejected.push(
          `${cand.el.tagName}.${String(cand.el.className || '').slice(0, 20)}@${cand.depth} ` +
            `(${cand.items.length} cells): ${why}${extra ? ` ${JSON.stringify(extra)}` : ''}`
        );
      }
    };
    const { cells, labels, hidden } = collectCells(document.body);
    hiddenCells = hidden;
    lap('collectCells');
    if (settings.debug) {
      const groups = candidates(cells);
      console.warn(
        `[Unit Bubble] pass: ${cells.length} chart-shaped cells, ${labels.length} labels, ` +
          `${groups.length} candidate containers` +
          (groups.length
            ? `\n  top: ${groups
                .slice(0, 4)
                .map((c) => `${c.el.tagName}.${String(c.el.className || '').slice(0, 18)}@${c.depth}(${c.items.length})`)
                .join(' ')}`
            : '')
      );
    }
    if (cells.length < 6) {
      refreshCta();
      lap('refreshCta');
      if (T) console.warn(`[Unit Bubble] timing (no chart): ${T.join(' | ')}`);
      return;
    }

    const accepted = [];
    for (const cand of candidates(cells)) {
      if (accepted.some((a) => a.contains(cand.el) || cand.el.contains(a))) continue;

      const grid = UB.chart.buildGrid(cand.items);
      if (!grid) {
        reject(cand, 'not a grid', UB.chart.explain ? UB.chart.explain(cand.items) : null);
        continue;
      }

      const near = labelsNear(grid, labels, overlayScope(cand.el));
      UB.chart.attachLabels(grid, near);
      if (!UB.chart.orient(grid)) {
        reject(cand, 'no measurement columns, only size systems', { headers: grid.headers });
        continue;
      }
      if (settings.debug) {
        console.warn('[Unit Bubble] chart', JSON.stringify({
          container: cand.el.tagName + '.' + String(cand.el.className || '').slice(0, 24),
          depth: cand.depth,
          cells: `${grid.cells.length}x${grid.cells[0].length}`,
          headers: grid.headers,
          rowLabels: grid.rowLabels,
          transposed: grid.transposed,
          demoted: !!grid.demotedSizeColumn,
          labelsNearby: near.length,
          candidates: near.slice(0, 20).map((l) => `${l.text}|${Math.round(l.rect.left)}-${Math.round(l.rect.right)}@${Math.round(l.rect.bottom)}`),
          colBands: grid.colBands.map((c) => `${Math.round(c.left)}-${Math.round(c.right)}`),
          firstRowTop: Math.round(grid.rowBands[0].top),
        }));
      }

      // A chart whose cells carry no unit needs stronger evidence that it is a
      // chart at all, since bare numbers are everywhere on a page.
      const unitless = cand.items.filter((i) => i.unit).length < cand.items.length / 2;
      if (unitless && !UB.chart.looksLikeSizes(grid.rowLabels) && !UB.chart.looksLikeMeasurements(grid.headers)) {
        reject(cand, 'unitless and looks like neither sizes nor measurements', {
          rowLabels: grid.rowLabels,
          headers: grid.headers,
        });
        continue;
      }

      const unit = UB.chart.inferUnit(cand.items, unitless ? scopeText(cand.el) : '');
      if (!unit || !UB.chart.applyUnit(cand.items, unit)) {
        reject(cand, 'unit could not be inferred', { unit, values: cand.items.slice(0, 8).map((i) => i.value) });
        continue;
      }

      const sourceImperial = imperial(unit);

      const chart = {
        el: cand.el,
        key: `${grid.cells.length}x${grid.cells[0].length}:${grid.cells[0]
          .map((c) => c && Math.round(c.mm))
          .join(',')}`,
        grid,
        roles: (grid.headers || []).map(UB.chart.columnRole),
        sourceUnit: sourceImperial ? 'in' : 'cm',
        unit,
        targetUnit: settings.length,
        labelHeader: 'Size',
        unitInferred: unitless,
      };
      // Which measurements this chart is compared against. Inferred from the
      // chart's own columns and the page's words, switchable in the panel.
      chart.setProfile = (id) => {
        chart.profileId = id;
        chart.values = UB.fit.valuesFor(settings, id);
        chart.pick =
          settings.chartHighlight === false
            ? null
            : UB.chart.pickSize(grid, chart.values, UB.fit.profile(id).primary);
        return chart;
      };
      chart.setProfile(UB.fit.detectProfile(grid.headers, pageSignal()));

      cand.el.setAttribute('data-ub-chart', '');
      // The panel is the conversion for a chart; chips inside it would be noise.
      for (const item of cand.items) {
        const hit = item.node.parentElement && item.node.parentElement.closest('.ub-hit');
        const chip = hit && hit.querySelector('.ub-chip');
        if (chip) chip.remove();
      }
      charts.set(cand.el, chart);
      accepted.push(cand.el);
      ctaChart = chart;
      watchChart(cand.el);
    }

    lap('candidates+grids');
    refreshCta();
    lap('refreshCta');
    flushDeferred();
    lap('flushDeferred');
    if (T) console.warn(`[Unit Bubble] timing: ${T.join(' | ')}`);
    if (rejected && rejected.length && !accepted.length) {
      console.warn(`[Unit Bubble] no chart from ${rejected.length} candidates:\n  ${rejected.slice(0, 8).join('\n  ')}`);
    }
  }

  // Opening is driven by the chart coming into view. Closing is not: the panel
  // stays until it is dismissed, so a store collapsing its own size guide — or
  // the chart scrolling away — doesn't take the conversions with it.
  function watchChart(el) {
    if (!chartObserver) {
      chartObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const chart = charts.get(entry.target);
            if (!chart || !entry.isIntersecting) continue;
            // The button is the invitation; opening on sight is opt-in, except
            // right after the button itself opened the store's guide.
            if (settings.chartAuto !== true && Date.now() >= forceOpenUntil) continue;
            UB.panel.show(chart);
          }
        },
        { threshold: 0.08 }
      );
    }
    chartObserver.observe(el);
  }

  // A chart whose element is gone (the store re-rendered, or you navigated
  // within an SPA) has nothing left to show.
  function dropDeadCharts() {
    for (const [el] of charts) {
      if (el.isConnected) continue;
      charts.delete(el); // re-detected if the store puts it back
    }
  }

  // Signalling that a chart is there.
  //
  // Two different questions, which used to be conflated into one "trigger":
  //   · what does the button DO — it needs a control that actually opens the
  //     store's size guide, an explicit "size chart" or "size guide";
  //   · where does it GO — next to that control, or above the chart itself
  //     once the chart is on screen.
  // Nothing is cached between passes: the first version latched onto whatever
  // matched first during hydration (a "SIZE AND FIT" accordion) and kept it,
  // so the button ended up toggling an accordion instead of opening anything.
  const CTA_LABEL = 'Open Chart';

  // Rank 0 and 1 are controls that open a chart. Rank 2+ merely mention sizing,
  // which is fine to sit beside but useless to click.
  const TRIGGER_RANK = [
    /chart|table|tabelle|tabella|taglie|tallas|tailles|tabel/i,
    /guide/i,
    /fit/i,
    /sizing|measurement|size (info|help)/i,
  ];
  const OPENER_MAX_RANK = 1;

  let ctaEl = null;
  let ctaAnchor = null;
  let ctaMode = null;
  let ctaChart = null;
  let hiddenCells = 0;
  let forceOpenUntil = 0;

  function triggerRank(el, own) {
    for (const raw of [own, el.getAttribute('aria-label'), el.getAttribute('title'), el.value]) {
      if (!raw || !UB.chart.looksLikeTrigger(raw)) continue;
      const label = UB.chart.normalizeLabel(raw);
      const rank = TRIGGER_RANK.findIndex((re) => re.test(label));
      return rank === -1 ? TRIGGER_RANK.length : rank;
    }
    return -1; // not a trigger
  }

  // The text a candidate owns, not what its descendants add up to, so a whole
  // product section doesn't read as a "size guide" label.
  function ownText(el) {
    let text = '';
    for (const node of el.childNodes) if (node.nodeType === Node.TEXT_NODE) text += node.nodeValue;
    return text;
  }

  // Whether clicking this thing plausibly does something. Stores build their
  // size-guide control out of anything: brut's is a bare <span> with no role,
  // no tabindex and no onclick — its only tell is cursor:pointer.
  function clickable(el) {
    const tag = el.tagName;
    if (tag === 'A' || tag === 'BUTTON' || tag === 'SUMMARY' || tag === 'LABEL') return true;
    if (el.getAttribute('role') === 'button' || el.hasAttribute('onclick') || el.hasAttribute('tabindex')) return true;
    try {
      if (getComputedStyle(el).cursor === 'pointer') return true;
      const parent = el.parentElement;
      if (parent && getComputedStyle(parent).cursor === 'pointer') return true;
    } catch {
      /* detached */
    }
    return false;
  }

  // A link to another page is not an opener. 3sixteen's "Measuring Guide" is a
  // nav link to a separate page, and a button promising the chart in your units
  // must not navigate away instead.
  function opensInPlace(el) {
    if (el.tagName !== 'A') return true;
    const href = el.getAttribute('href');
    if (!href || href.startsWith('#') || href.toLowerCase().startsWith('javascript:')) return true;
    try {
      const url = new URL(href, location.href);
      return url.origin === location.origin && url.pathname === location.pathname;
    } catch {
      return true;
    }
  }

  function scanTriggers() {
    const found = [];
    for (const el of document.querySelectorAll('*')) {
      // Cheap gates first: a label is a short leaf, and there are thousands of
      // elements on a store page.
      if (el.children.length > 2) continue;
      const all = el.textContent;
      if (!all || all.length > 60) continue;
      if (el.classList.contains('ub-cta') || el.closest('[data-ub-root]')) continue;
      const rank = triggerRank(el, ownText(el));
      if (rank === -1) continue;
      const box = el.getBoundingClientRect();
      found.push({ el, rank, opens: clickable(el) && opensInPlace(el), visible: box.width > 0 && box.height > 0 });
    }
    // Visible first: stores repeat the same control in a mobile drawer and a
    // footer, and clicking a hidden copy does nothing at all — which left the
    // button sitting invisible inside a collapsed menu.
    return found.sort(
      (a, b) => Number(b.visible) - Number(a.visible) || Number(b.opens) - Number(a.opens) || a.rank - b.rank
    );
  }

  // The control whose click opens the store's own size guide.
  function bestOpener(triggers = scanTriggers()) {
    for (const { el, rank, opens, visible } of triggers) {
      if (!opens || !visible || rank > OPENER_MAX_RANK) continue;
      // An opener that contains our button is fine and common — the button is
      // appended inside the store's own link. Our click stops at the shadow
      // host, so the link is activated programmatically instead. Clicking the
      // innermost matching element is right either way: the event bubbles to
      // whichever ancestor actually holds the listener.
      return el;
    }
    return null;
  }

  function ctaClick() {
    if (ctaChart) return UB.panel.show(ctaChart);
    const opener = bestOpener();
    if (!opener) return;
    forceOpenUntil = Date.now() + 2500;
    opener.click();
    queueRecheck(250);
    setTimeout(() => queueRecheck(0), 800);
  }

  function createCta() {
    const cta = document.createElement('button');
    cta.type = 'button';
    cta.textContent = CTA_LABEL;
    cta.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      ctaClick();
    });
    return cta;
  }

  function removeCta() {
    if (ctaEl) ctaEl.remove();
    ctaEl = null;
    ctaAnchor = null;
    ctaMode = null;
  }

  function placeCta(anchor, mode) {
    if (!anchor || !anchor.parentElement) return;
    const cta = ctaEl && ctaEl.isConnected ? ctaEl : createCta();
    ctaEl = cta;
    cta.title = `Read this size chart in ${settings.length === 'in' ? 'inches' : 'centimeters'}`;
    if (ctaAnchor === anchor && ctaMode === mode && cta.isConnected) return;
    // Leave a button that is placed and visible where it is. Moving it every
    // time the store opened or closed its modal read as a flash.
    if (cta.isConnected && ctaAnchor && ctaAnchor.isConnected && cta.getBoundingClientRect().height > 0) return;

    cta.className = mode === 'block' ? 'ub-cta ub-cta-block' : 'ub-cta';
    if (mode === 'block') {
      anchor.insertAdjacentElement('beforebegin', cta);
    } else if (/block|flex|grid|list-item|table/.test(getComputedStyle(anchor).display)) {
      // After a block-level label the button would land on its own line and
      // push the page around. Inside it, it sits on the same line as the text.
      anchor.append(cta);
    } else {
      anchor.insertAdjacentElement('afterend', cta);
    }
    ctaAnchor = anchor;
    ctaMode = mode;
  }

  // Recomputed every pass, so placement self-corrects however late the store
  // hydrates. The button only exists when it has something to do.
  function refreshCta() {
    for (const [el, chart] of charts) {
      if (!el.isConnected || !el.getBoundingClientRect().height) continue;
      ctaChart = chart;
      const block = el.closest('table,figure,section,article') || el;
      return placeCta(block, 'block');
    }

    const triggers = scanTriggers();
    const opener = bestOpener(triggers);
    // Scanning real stores showed the button promising a chart and failing to
    // deliver on 12 of 22 pages, because a size-guide label is not evidence
    // that a chart exists — it might open a page, or an image. Evidence is: a
    // chart we have already read, or chart-shaped cells sitting hidden in the
    // DOM waiting to be shown.
    const evidence = !!ctaChart || hiddenCells >= 6;
    if (!opener || !evidence) {
      if (!ctaChart) return removeCta();
    }
    if (ctaEl && ctaEl.isConnected && ctaAnchor && ctaAnchor.isConnected) return; // already placed
    const visibleTrigger = triggers.find((t) => t.visible);
    const anchor = opener || (visibleTrigger && visibleTrigger.el);
    if (!anchor) return removeCta();
    placeCta(anchor, 'inline');
  }

  function pageSignal() {
    const parts = [document.title];
    const h1 = document.querySelector('h1');
    if (h1) parts.push(h1.textContent);
    for (const el of document.querySelectorAll('[class*=breadcrumb] a,[class*=product-type],[itemprop=category]')) {
      parts.push(el.textContent);
    }
    return parts.join(' ').slice(0, 400);
  }

  /* ---------- lifecycle ---------- */

  let observer = null;
  let pending = false;

  function pass(root) {
    if (!active) return;
    const started = settings.debug ? performance.now() : 0;
    const nodes = collect(root || document.body);
    let marked = 0;
    for (const node of nodes) {
      if (marked >= MARK_BUDGET) {
        queuePass(); // more to do: continue in the next idle slice
        break;
      }
      try {
        marked += mark(node) ? 1 : 0;
      } catch {
        /* pages move nodes mid-pass; the next pass picks them up */
      }
    }
    tidyCurrencyCodes();
    // Charts need layout, so read geometry after the marking writes settle.
    // This runs even when nothing was marked: a chart of bare numbers has
    // nothing for the marker to mark, and is still a chart.
    // Detection runs first; whatever it doesn't claim gets chipped there.
    requestAnimationFrame(() => queueRecheck(0));
  }

  function queuePass() {
    if (pending || !active) return;
    pending = true;
    const run = () => {
      pending = false;
      pass(document.body);
    };
    if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 600 });
    else setTimeout(run, 120);
  }

  function start() {
    if (active) return;
    active = true;
    document.documentElement.classList.toggle('ub-quiet', !settings.underline);
    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mouseout', onOut, true);
    window.addEventListener('scroll', hideBubble, { passive: true, capture: true });
    pass(document.body);
    observer = new MutationObserver((records) => {
      let recheck = false;
      for (const r of records) {
        if (r.target instanceof Element && r.target.closest('[data-ub-root]')) continue;
        if ((r.type === 'childList' && r.addedNodes.length) || r.type === 'characterData') return queuePass();
        if (r.type === 'attributes') recheck = true;
      }
      if (recheck) queueRecheck(150);
    });
    for (const delay of [300, 900, 2000, 4500]) setTimeout(() => queueRecheck(0), delay);
    window.addEventListener('load', () => queueRecheck(150), { once: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      UB.panel.keepAlive();
      queueRecheck(150);
    });
    window.addEventListener('focus', () => UB.panel.keepAlive());
    window.addEventListener('pageshow', () => UB.panel.keepAlive());

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-hidden'],
    });
  }

  function stop() {
    active = false;
    if (observer) observer.disconnect();
    if (chartObserver) chartObserver.disconnect();
    if (visibilityWatcher) visibilityWatcher.disconnect();
    observer = null;
    chartObserver = null;
    visibilityWatcher = null;
    document.removeEventListener('mouseover', onOver, true);
    document.removeEventListener('mouseout', onOut, true);
    window.removeEventListener('scroll', hideBubble, true);
    unmark();
  }

  function enabledHere(s) {
    if (!s.enabled) return false;
    const hostname = location.hostname.replace(/^www\./, '');
    return !(s.disabledHosts || []).some((h) => hostname === h || hostname.endsWith(`.${h}`));
  }

  function apply(next) {
    settings = { ...UB.DEFAULT_SETTINGS, ...next };
    document.documentElement.classList.toggle('ub-quiet', !settings.underline);
    if (!enabledHere(settings)) return stop();
    if (!active) return start();
    unmark();
    seen = new WeakSet(); // nodes skipped under the old settings may convert now
    pass(document.body);
    queueRecheck(80);
  }

  chrome.storage.sync.get('settings', ({ settings: stored }) => {
    settings = { ...UB.DEFAULT_SETTINGS, ...(stored || {}) };
    chrome.runtime.sendMessage({ type: 'getRates' }, (res) => {
      if (res && res.rates) {
        rates = res.rates;
        ratesFetchedAt = res.fetchedAt || 0;
      }
      if (enabledHere(settings)) start();
    });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.settings) apply(changes.settings.newValue || {});
    if (area === 'local' && changes.rates && changes.rates.newValue) {
      rates = changes.rates.newValue.rates || rates;
      ratesFetchedAt = changes.rates.newValue.fetchedAt || ratesFetchedAt;
    }
  });
})();

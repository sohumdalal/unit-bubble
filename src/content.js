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
    const shadow = bubbleHost.attachShadow({ mode: 'closed' });
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

  function mark(node) {
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

  function unmark() {
    for (const hit of document.querySelectorAll('.ub-hit')) {
      const parent = hit.parentNode;
      if (!parent) continue;
      const original = hit.firstChild && hit.firstChild.nodeType === Node.TEXT_NODE ? hit.firstChild.nodeValue : hit.textContent;
      parent.replaceChild(document.createTextNode(original), hit);
      parent.normalize();
    }
    for (const el of document.querySelectorAll('[data-ub-chart]')) el.removeAttribute('data-ub-chart');
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
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const text = node.nodeValue;
        if (!text || !text.trim() || text.length > 40) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent || CELL_SKIP.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (parent.classList && parent.classList.contains('ub-chip')) return NodeFilter.FILTER_REJECT;
        if (parent.closest('[data-ub-root],[data-ub-chart]')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (cells.length + labels.length < MAX_CELLS && walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.nodeValue.trim();
      const cell = UB.chart.parseCell(text);
      const rect = rangeRect(node);
      if (!rect) {
        if (cell) watchForVisible(node.parentElement);
        continue;
      }
      if (cell) cells.push({ ...cell, rect, node });
      else if (text.length <= 28) labels.push({ text, rect });
    }
    return { cells, labels };
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
    return [...byEl.values()]
      .filter((c) => c.items.length >= 6)
      .sort((a, b) => a.depth - b.depth || b.items.length - a.items.length);
  }

  // Labels near the grid, by geometry rather than by DOM ancestry: a header row
  // usually sits outside the element the values live in.
  function labelsNear(grid, labels) {
    const top = grid.rowBands[0].top;
    const bottom = grid.rowBands[grid.rowBands.length - 1].bottom;
    const left = grid.colBands[0].left;
    const right = grid.colBands[grid.colBands.length - 1].right;
    const padY = Math.max((bottom - top) * 0.5, 80);
    const padX = Math.max((right - left) * 0.5, 120);
    return labels.filter(
      (l) =>
        l.rect.right > left - padX &&
        l.rect.left < right + padX &&
        l.rect.bottom > top - padY &&
        l.rect.top < bottom + padY
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
    const { cells, labels } = collectCells(document.body);
    if (cells.length < 6) return;

    const accepted = [];
    for (const cand of candidates(cells)) {
      if (accepted.some((a) => a.contains(cand.el) || cand.el.contains(a))) continue;

      const grid = UB.chart.buildGrid(cand.items);
      if (!grid) continue;

      UB.chart.attachLabels(grid, labelsNear(grid, labels));
      UB.chart.orient(grid);

      // A chart whose cells carry no unit needs stronger evidence that it is a
      // chart at all, since bare numbers are everywhere on a page.
      const unitless = cand.items.filter((i) => i.unit).length < cand.items.length / 2;
      if (unitless && !UB.chart.looksLikeSizes(grid.rowLabels) && !UB.chart.looksLikeMeasurements(grid.headers)) {
        continue;
      }

      const unit = UB.chart.inferUnit(cand.items, unitless ? scopeText(cand.el) : '');
      if (!unit || !UB.chart.applyUnit(cand.items, unit)) continue;

      // A chart already in the unit you read needs no panel.
      const sourceImperial = imperial(unit);
      if (sourceImperial === (settings.length === 'in')) continue;

      const chart = {
        el: cand.el,
        key: `${grid.cells.length}x${grid.cells[0].length}:${grid.cells[0]
          .map((c) => c && Math.round(c.mm))
          .join(',')}`,
        grid,
        roles: (grid.headers || []).map(UB.chart.columnRole),
        sourceUnit: sourceImperial ? 'in' : unit,
        targetUnit: settings.length,
        labelHeader: 'Size',
        unitInferred: unitless,
        autoOpen: settings.chartAuto !== false,
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
      watchChart(cand.el);
    }
  }

  function watchChart(el) {
    if (!chartObserver) {
      chartObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const chart = charts.get(entry.target);
            if (!chart) continue;
            if (entry.isIntersecting) UB.panel.show(chart);
            else if (UB.panel.current() === chart.key) UB.panel.hide();
          }
        },
        { threshold: 0.08 }
      );
    }
    chartObserver.observe(el);
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
    for (const node of collect(root || document.body)) {
      try {
        mark(node);
      } catch {
        /* pages move nodes mid-pass; the next pass picks them up */
      }
    }
    tidyCurrencyCodes();
    // Charts need layout, so read geometry after the marking writes settle.
    // This runs even when nothing was marked: a chart of bare numbers has
    // nothing for the marker to mark, and is still a chart.
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

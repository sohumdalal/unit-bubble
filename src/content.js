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
      font: 400 12px/1.35 ui-sans-serif, -apple-system, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
      background: rgba(255,255,255,.88); color: #0b0b0c;
      -webkit-backdrop-filter: saturate(180%) blur(14px); backdrop-filter: saturate(180%) blur(14px);
      border: 1px solid rgba(0,0,0,.08);
      box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 8px 24px -6px rgba(0,0,0,.22);
      opacity: 0; transform: translateY(3px); transition: opacity .12s ease, transform .14s cubic-bezier(.2,.8,.2,1);
    }
    .b.in { opacity: 1; transform: none; }
    .v { font-size: 14px; font-weight: 590; letter-spacing: -.01em; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .o { margin-top: 2px; font-size: 11px; color: rgba(0,0,0,.45); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .n { margin-top: 3px; font-size: 10px; color: rgba(0,0,0,.34); white-space: nowrap; }
    .stale { color: #a2600b; }
    @media (prefers-color-scheme: dark) {
      .b { background: rgba(28,28,30,.86); color: #f5f5f7; border-color: rgba(255,255,255,.1);
           box-shadow: 0 1px 2px rgba(0,0,0,.4), 0 10px 28px -6px rgba(0,0,0,.6); }
      .o { color: rgba(255,255,255,.5); } .n { color: rgba(255,255,255,.36); } .stale { color: #f0b76b; }
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
      cursor = m.end;
    }
    if (cursor < text.length) frag.append(document.createTextNode(text.slice(cursor)));
    node.parentNode.replaceChild(frag, node);
    return usable.length;
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
  let chartObserver = null;

  const imperial = (unit) => unit === 'in' || unit === 'ft' || unit === 'ftin';

  function labelCandidates(container) {
    const out = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const t = node.nodeValue && node.nodeValue.trim();
        if (!t || t.length > 28) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent || SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (parent.closest('.ub-hit,[data-ub-root]')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) continue;
      out.push({ text: node.nodeValue.trim(), rect });
    }
    return out;
  }

  // Ancestors that hold enough length values to be a chart, deepest first, so
  // the tightest container that parses wins over the whole page body.
  function candidates(hits) {
    const byEl = new Map();
    for (const hit of hits) {
      let el = hit.el.parentElement;
      for (let depth = 0; el && depth < 10; depth++, el = el.parentElement) {
        if (!byEl.has(el)) byEl.set(el, { el, depth, items: [] });
        byEl.get(el).items.push(hit);
      }
    }
    return [...byEl.values()]
      .filter((c) => c.items.length >= MIN_CHART_HITS)
      .sort((a, b) => b.depth - a.depth || a.items.length - b.items.length);
  }

  function detectCharts() {
    const hits = [];
    for (const el of document.querySelectorAll('.ub-hit[data-ub-kind="length"]')) {
      if (el.closest('[data-ub-chart]')) continue;
      const data = readMatch(el);
      const rect = originalRect(el);
      if (!data || !rect || (!rect.width && !rect.height)) continue;
      hits.push({ el, mm: data.mm, unit: data.unit, text: data.text, rect });
    }
    if (hits.length < MIN_CHART_HITS) return;

    const accepted = [];
    for (const cand of candidates(hits)) {
      if (accepted.some((a) => a.contains(cand.el) || cand.el.contains(a))) continue;

      const grid = UB.chart.buildGrid(cand.items);
      if (!grid) continue;

      // A chart already in the unit you read needs no panel.
      const sourceImperial = cand.items.filter((i) => imperial(i.unit)).length > cand.items.length / 2;
      if (sourceImperial === (settings.length === 'in')) continue;

      UB.chart.attachLabels(grid, labelCandidates(cand.el));
      const measurements = {};
      for (const [role, cm] of Object.entries(settings.measurementsCm || {})) {
        if (cm) measurements[role] = Number(cm) * 10;
      }

      const chart = {
        key: `${cand.depth}:${grid.cells.length}x${grid.colBands.length}:${grid.cells[0]
          .map((c) => c && Math.round(c.mm))
          .join(',')}`,
        grid,
        sourceUnit: sourceImperial ? 'in' : 'cm',
        targetUnit: settings.length,
        labelHeader: 'Size',
        pick: UB.chart.pickSize(grid, measurements),
      };

      cand.el.setAttribute('data-ub-chart', '');
      // The panel is the conversion for a chart; chips inside it would be noise.
      for (const item of cand.items) {
        const chip = item.el.querySelector('.ub-chip');
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

  /* ---------- lifecycle ---------- */

  let observer = null;
  let pending = false;

  function pass(root) {
    if (!active) return;
    let marked = 0;
    for (const node of collect(root || document.body)) {
      try {
        marked += mark(node);
      } catch {
        /* pages move nodes mid-pass; the next pass picks them up */
      }
    }
    if (marked) {
      // Charts need layout, so read geometry after the marking writes settle.
      requestAnimationFrame(() => {
        try {
          detectCharts();
        } catch (err) {
          console.warn('[Unit Bubble] chart detection failed:', err);
        }
      });
    }
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
      for (const r of records) {
        if (r.target instanceof Element && r.target.closest('[data-ub-root]')) continue;
        if ((r.type === 'childList' && r.addedNodes.length) || r.type === 'characterData') return queuePass();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  }

  function stop() {
    active = false;
    if (observer) observer.disconnect();
    if (chartObserver) chartObserver.disconnect();
    observer = null;
    chartObserver = null;
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

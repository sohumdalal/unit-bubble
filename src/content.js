// Walks visible text, wraps prices and measurements in a marker span, and shows
// one shared bubble on hover. The bubble lives in a shadow root so no page CSS
// can touch it and none of ours leaks out.
(function () {
  const UB = window.UB;
  if (!UB || window.__ubLoaded) return;
  window.__ubLoaded = true;

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
    'IFRAME', 'CANVAS', 'SVG', 'MATH', 'TEMPLATE', 'HEAD', 'TITLE',
  ]);
  const MAX_NODES_PER_PASS = 1200;
  const MIN_TEXT = 2;

  let settings = { ...UB.DEFAULT_SETTINGS };
  let rates = { ...UB.FALLBACK_RATES };
  let ratesFetchedAt = 0;
  let active = false;
  let seen = new WeakSet();

  /* ---------- bubble ---------- */

  let host = null;
  let shadow = null;
  let bubble = null;
  let hideTimer = null;
  let current = null;

  const BUBBLE_CSS = `
    :host { all: initial; }
    .b {
      position: fixed; z-index: 2147483647; pointer-events: none;
      box-sizing: border-box; min-width: 84px; max-width: 260px;
      padding: 7px 10px 8px; border-radius: 10px;
      font: 400 12px/1.35 ui-sans-serif, -apple-system, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
      background: rgba(255,255,255,.86);
      -webkit-backdrop-filter: saturate(180%) blur(14px);
      backdrop-filter: saturate(180%) blur(14px);
      color: #0b0b0c;
      border: 1px solid rgba(0,0,0,.08);
      box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 8px 24px -6px rgba(0,0,0,.22);
      opacity: 0; transform: translateY(3px) scale(.985);
      transition: opacity .12s ease, transform .14s cubic-bezier(.2,.8,.2,1);
      will-change: opacity, transform;
    }
    .b.in { opacity: 1; transform: none; }
    .v {
      font-size: 15px; font-weight: 590; letter-spacing: -.01em;
      font-variant-numeric: tabular-nums; white-space: nowrap;
    }
    .o {
      margin-top: 2px; font-size: 11px; color: rgba(0,0,0,.45);
      font-variant-numeric: tabular-nums; white-space: nowrap;
    }
    .n { margin-top: 3px; font-size: 10px; color: rgba(0,0,0,.34); white-space: nowrap; }
    .stale { color: #a2600b; }
    @media (prefers-color-scheme: dark) {
      .b {
        background: rgba(28,28,30,.82); color: #f5f5f7;
        border-color: rgba(255,255,255,.1);
        box-shadow: 0 1px 2px rgba(0,0,0,.4), 0 10px 28px -6px rgba(0,0,0,.6);
      }
      .o { color: rgba(255,255,255,.5); }
      .n { color: rgba(255,255,255,.36); }
      .stale { color: #f0b76b; }
    }
    @media (prefers-reduced-motion: reduce) { .b { transition: none; } }
  `;

  function ensureBubble() {
    if (bubble) return bubble;
    host = document.createElement('div');
    host.setAttribute('data-ub-root', '');
    host.style.cssText = 'all:initial;position:static';
    shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = BUBBLE_CSS;
    bubble = document.createElement('div');
    bubble.className = 'b';
    bubble.innerHTML = '<div class="v"></div><div class="o"></div><div class="n"></div>';
    shadow.append(style, bubble);
    (document.body || document.documentElement).appendChild(host);
    return bubble;
  }

  function show(target, conv) {
    const b = ensureBubble();
    const stale = Date.now() - ratesFetchedAt > 36 * 3600 * 1000;
    b.querySelector('.v').textContent = conv.primary || conv.original;
    const o = b.querySelector('.o');
    o.textContent = conv.primary ? conv.original : '';
    o.hidden = !conv.primary;
    const n = b.querySelector('.n');
    const note = conv.note ? (stale && ratesFetchedAt ? `${conv.note} · rate is stale` : conv.note) : '';
    n.textContent = note;
    n.hidden = !note;
    n.className = 'n' + (stale && ratesFetchedAt ? ' stale' : '');

    // Measure first, then place: above the text if there is room, else below.
    b.style.visibility = 'hidden';
    b.classList.add('in');
    const r = target.getBoundingClientRect();
    const bw = b.offsetWidth;
    const bh = b.offsetHeight;
    const gap = 8;
    let top = r.top - bh - gap;
    if (top < 6) top = Math.min(r.bottom + gap, window.innerHeight - bh - 6);
    let left = r.left + r.width / 2 - bw / 2;
    left = Math.max(6, Math.min(left, window.innerWidth - bw - 6));
    b.style.top = `${Math.round(top)}px`;
    b.style.left = `${Math.round(left)}px`;
    b.style.visibility = 'visible';
    current = target;
  }

  function hide() {
    if (bubble) bubble.classList.remove('in');
    current = null;
  }

  /* ---------- hover wiring (delegated, so dynamic pages cost nothing) ---------- */

  function onOver(e) {
    const hit = e.target instanceof Element ? e.target.closest('.ub-hit') : null;
    if (!hit) return;
    clearTimeout(hideTimer);
    if (hit === current) return;
    let data;
    try {
      data = JSON.parse(hit.dataset.ub);
    } catch {
      return;
    }
    const conv = UB.convert(data, settings, rates);
    if (conv) show(hit, conv);
  }

  function onOut(e) {
    const hit = e.target instanceof Element ? e.target.closest('.ub-hit') : null;
    if (!hit) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 90);
  }

  /* ---------- scanning ---------- */

  function skip(node) {
    const parent = node.parentElement;
    if (!parent) return true;
    if (SKIP_TAGS.has(parent.tagName)) return true;
    if (parent.closest('[data-ub-root],[contenteditable=""],[contenteditable="true"],.ub-hit')) return true;
    return false;
  }

  function collect(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (seen.has(node)) return NodeFilter.FILTER_REJECT;
        const text = node.nodeValue;
        if (!text || text.length < MIN_TEXT || !/\d/.test(text)) return NodeFilter.FILTER_REJECT;
        if (skip(node)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (nodes.length < MAX_NODES_PER_PASS && walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  function wrap(node) {
    seen.add(node);
    const text = node.nodeValue;
    const matches = UB.detect.findMatches(text, settings);
    if (!matches.length) return;

    // Only mark matches that actually convert to something different.
    const usable = matches.filter((m) => UB.convert(m, settings, rates));
    if (!usable.length) return;

    const frag = document.createDocumentFragment();
    let cursor = 0;
    for (const m of usable) {
      if (m.start > cursor) frag.append(document.createTextNode(text.slice(cursor, m.start)));
      const span = document.createElement('span');
      span.className = 'ub-hit';
      span.dataset.ub = JSON.stringify(m);
      span.textContent = text.slice(m.start, m.end);
      frag.append(span);
      cursor = m.end;
    }
    if (cursor < text.length) frag.append(document.createTextNode(text.slice(cursor)));
    node.parentNode.replaceChild(frag, node);
  }

  function scan(root) {
    if (!active) return;
    for (const node of collect(root || document.body)) {
      try {
        wrap(node);
      } catch {
        /* a page can move nodes mid-pass; the next pass picks them up */
      }
    }
  }

  function unmark() {
    for (const hit of document.querySelectorAll('.ub-hit')) {
      const parent = hit.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(hit.textContent), hit);
      parent.normalize();
    }
    hide();
  }

  /* ---------- lifecycle ---------- */

  let observer = null;
  let pending = false;

  function queueScan() {
    if (pending || !active) return;
    pending = true;
    const run = () => {
      pending = false;
      scan(document.body);
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
    window.addEventListener('scroll', hide, { passive: true, capture: true });
    scan(document.body);
    observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'childList' && r.addedNodes.length) return queueScan();
        if (r.type === 'characterData') return queueScan();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  }

  function stop() {
    active = false;
    if (observer) observer.disconnect();
    observer = null;
    document.removeEventListener('mouseover', onOver, true);
    document.removeEventListener('mouseout', onOut, true);
    window.removeEventListener('scroll', hide, true);
    unmark();
  }

  function enabledHere(s) {
    if (!s.enabled) return false;
    const hostname = location.hostname.replace(/^www\./, '');
    return !(s.disabledHosts || []).some((h) => hostname === h || hostname.endsWith(`.${h}`));
  }

  function apply(next, { rescan = false } = {}) {
    settings = { ...UB.DEFAULT_SETTINGS, ...next };
    document.documentElement.classList.toggle('ub-quiet', !settings.underline);
    if (!enabledHere(settings)) return stop();
    if (!active) return start();
    if (rescan) {
      unmark();
      seen = new WeakSet(); // settings changed: nodes skipped before may convert now
      scan(document.body);
    }
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
    if (area === 'sync' && changes.settings) apply(changes.settings.newValue || {}, { rescan: true });
    if (area === 'local' && changes.rates && changes.rates.newValue) {
      rates = changes.rates.newValue.rates || rates;
      ratesFetchedAt = changes.rates.newValue.fetchedAt || ratesFetchedAt;
    }
  });
})();

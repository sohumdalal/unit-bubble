// The size-chart panel: a self-contained card that re-renders a detected chart
// in the unit you actually read, with a toggle back to the original. Lives in
// its own shadow root, so the host page's CSS can't reach it.
(function (root) {
  const UB = (root.UB = root.UB || {});

  const CSS = `
    :host { all: initial; }
    .wrap {
      position: fixed; z-index: 2147483646;
      right: 18px; bottom: 18px; width: 336px; max-width: calc(100vw - 32px);
      box-sizing: border-box; border-radius: 14px; overflow: hidden;
      font: 400 12px/1.45 ui-sans-serif, -apple-system, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
      color: #0b0b0c;
      background: rgba(252,252,253,.92);
      -webkit-backdrop-filter: saturate(180%) blur(16px);
      backdrop-filter: saturate(180%) blur(16px);
      border: 1px solid rgba(0,0,0,.1);
      box-shadow: 0 2px 6px rgba(0,0,0,.06), 0 18px 48px -12px rgba(0,0,0,.35);
      opacity: 0; transform: translateY(8px) scale(.99);
      transition: opacity .16s ease, transform .2s cubic-bezier(.2,.8,.2,1);
    }
    .wrap.in { opacity: 1; transform: none; }
    header {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 10px 10px 12px;
      border-bottom: 1px solid rgba(0,0,0,.07);
      cursor: grab; user-select: none;
    }
    header.drag { cursor: grabbing; }
    .dot {
      width: 14px; height: 14px; border-radius: 50%; flex: 0 0 auto;
      background: linear-gradient(145deg, #6f6ff0, #4b3fd1);
    }
    h2 { margin: 0; font-size: 12px; font-weight: 590; letter-spacing: -.01em; flex: 1 1 auto; }
    .seg {
      display: flex; padding: 2px; gap: 2px; border-radius: 7px;
      background: rgba(0,0,0,.06); flex: 0 0 auto;
    }
    .seg button {
      font: 590 10.5px/1 inherit; letter-spacing: .02em; text-transform: uppercase;
      border: 0; border-radius: 5px; padding: 4px 7px; cursor: pointer;
      background: transparent; color: rgba(11,11,12,.55);
    }
    .seg button[aria-pressed="true"] { background: #fff; color: #0b0b0c; box-shadow: 0 1px 2px rgba(0,0,0,.14); }
    .x {
      border: 0; background: transparent; cursor: pointer; flex: 0 0 auto;
      width: 22px; height: 22px; border-radius: 6px; color: rgba(11,11,12,.45);
      font: 400 14px/1 inherit;
    }
    .x:hover { background: rgba(0,0,0,.06); color: inherit; }
    .body { max-height: min(56vh, 460px); overflow: auto; padding: 4px 6px 6px; }
    table { border-collapse: collapse; width: 100%; }
    th, td {
      padding: 6px 8px; text-align: right; white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    th {
      position: sticky; top: 0; z-index: 1;
      font-size: 9.5px; font-weight: 590; letter-spacing: .05em; text-transform: uppercase;
      color: rgba(11,11,12,.45); background: rgba(252,252,253,.96);
      border-bottom: 1px solid rgba(0,0,0,.08);
    }
    th:first-child, td:first-child { text-align: left; }
    td { border-bottom: 1px solid rgba(0,0,0,.05); }
    tr:last-child td { border-bottom: 0; }
    td.size { font-weight: 590; }
    tr.pick td { background: rgba(91,91,214,.1); }
    tr.pick td:first-child { box-shadow: inset 2px 0 0 #5b5bd6; }
    .foot {
      display: flex; align-items: center; gap: 6px; justify-content: space-between;
      padding: 8px 12px 10px; border-top: 1px solid rgba(0,0,0,.07);
      font-size: 10.5px; color: rgba(11,11,12,.45);
    }
    .foot a { color: #5b5bd6; text-decoration: none; }
    .foot a:hover { text-decoration: underline; }
    .pill {
      position: fixed; z-index: 2147483646; right: 18px; bottom: 18px;
      display: flex; align-items: center; gap: 7px;
      padding: 8px 12px; border-radius: 999px; cursor: pointer;
      font: 590 11.5px/1 ui-sans-serif, -apple-system, system-ui, sans-serif;
      color: #0b0b0c; background: rgba(252,252,253,.94);
      -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
      border: 1px solid rgba(0,0,0,.1);
      box-shadow: 0 2px 6px rgba(0,0,0,.08), 0 10px 28px -10px rgba(0,0,0,.3);
    }
    @media (prefers-color-scheme: dark) {
      .wrap, .pill { background: rgba(28,28,30,.9); color: #f5f5f7; border-color: rgba(255,255,255,.12); }
      header, .foot, th { border-color: rgba(255,255,255,.09); }
      th { background: rgba(28,28,30,.96); color: rgba(245,245,247,.5); }
      td { border-color: rgba(255,255,255,.06); }
      .seg { background: rgba(255,255,255,.1); }
      .seg button { color: rgba(245,245,247,.6); }
      .seg button[aria-pressed="true"] { background: rgba(255,255,255,.18); color: #fff; box-shadow: none; }
      .x:hover { background: rgba(255,255,255,.1); }
      tr.pick td { background: rgba(139,139,240,.18); }
      tr.pick td:first-child { box-shadow: inset 2px 0 0 #8b8bf0; }
      .foot a { color: #8b8bf0; }
    }
    @media (prefers-reduced-motion: reduce) { .wrap { transition: none; } }
  `;

  let host = null;
  let shadow = null;
  let state = null; // { chart, unit, pos, collapsed }

  function ensureHost() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.setAttribute('data-ub-root', '');
    host.style.cssText = 'all:initial;position:static';
    shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = CSS;
    shadow.append(style);
    (document.body || document.documentElement).appendChild(host);
  }

  function clear() {
    if (!shadow) return;
    for (const el of [...shadow.children]) if (el.tagName !== 'STYLE') el.remove();
  }

  const IMPERIAL = new Set(['in', 'ft', 'ftin']);
  const other = (unit) => (IMPERIAL.has(unit) ? 'cm' : 'in');

  function cellText(item, unit) {
    if (!item) return '—';
    if (unit === 'orig') return item.text.replace(/\s+/g, ' ');
    const mm = item.mm;
    if (unit === 'in') {
      const inches = mm / 25.4;
      return inches >= 36 ? UB.format.length(mm, 'ftin') : `${UB.format.num(inches, 1)}″`;
    }
    return mm >= 1000 ? `${UB.format.num(mm / 1000, 2)} m` : `${UB.format.num(mm / 10, 1)} cm`;
  }

  function render() {
    if (!state) return;
    ensureHost();
    clear();
    const { chart, unit } = state;
    const grid = chart.grid;

    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    if (state.pos) {
      wrap.style.left = `${state.pos.left}px`;
      wrap.style.top = `${state.pos.top}px`;
      wrap.style.right = 'auto';
      wrap.style.bottom = 'auto';
    }

    const head = document.createElement('header');
    head.innerHTML = `
      <i class="dot"></i>
      <h2>Size chart</h2>
      <div class="seg">
        <button data-u="orig" aria-pressed="${unit === 'orig'}">${chart.sourceUnit}</button>
        <button data-u="${chart.targetUnit}" aria-pressed="${unit !== 'orig'}">${chart.targetUnit === 'in' ? 'in' : 'cm'}</button>
      </div>
      <button class="x" title="Hide">✕</button>`;

    const body = document.createElement('div');
    body.className = 'body';
    const table = document.createElement('table');
    const headers = grid.headers || [];
    table.innerHTML =
      `<thead><tr><th>${escape(chart.labelHeader || 'Size')}</th>${headers
        .map((h, i) => `<th>${escape(h || `Col ${i + 1}`)}</th>`)
        .join('')}</tr></thead><tbody>${grid.cells
        .map((row, r) => {
          const picked = chart.pick && chart.pick.row === r ? ' class="pick"' : '';
          return `<tr${picked}><td class="size">${escape(grid.rowLabels[r] || '·')}</td>${row
            .map((item) => `<td>${escape(cellText(item, unit))}</td>`)
            .join('')}</tr>`;
        })
        .join('')}</tbody>`;
    body.append(table);

    const foot = document.createElement('div');
    foot.className = 'foot';
    if (chart.pick) {
      const over = chart.pick.over ? 'largest listed' : 'best fit';
      foot.innerHTML = `<span>Your ${chart.pick.role} → <strong>${escape(
        chart.pick.label
      )}</strong> · ${over}</span><a href="#" data-act="settings">edit</a>`;
    } else {
      foot.innerHTML = `<span>Converted from this page's chart</span><a href="#" data-act="settings">add your measurements</a>`;
    }

    wrap.append(head, body, foot);
    shadow.append(wrap);
    requestAnimationFrame(() => wrap.classList.add('in'));

    head.querySelectorAll('.seg button').forEach((b) => {
      b.onclick = () => {
        state.unit = b.dataset.u;
        render();
      };
    });
    head.querySelector('.x').onclick = () => {
      state.collapsed = true;
      render();
    };
    foot.querySelector('[data-act=settings]').onclick = (e) => {
      e.preventDefault();
      chrome.runtime.sendMessage({ type: 'openOptions' });
    };
    makeDraggable(wrap, head);

    if (state.collapsed) {
      clear();
      const pill = document.createElement('button');
      pill.className = 'pill';
      pill.innerHTML = `<i class="dot"></i> Size chart in ${chart.targetUnit === 'in' ? 'inches' : 'cm'}`;
      pill.onclick = () => {
        state.collapsed = false;
        render();
      };
      shadow.append(pill);
    }
  }

  function makeDraggable(wrap, handle) {
    handle.onpointerdown = (e) => {
      if (e.target.closest('button')) return;
      const r = wrap.getBoundingClientRect();
      const dx = e.clientX - r.left;
      const dy = e.clientY - r.top;
      handle.classList.add('drag');
      handle.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const left = Math.max(6, Math.min(ev.clientX - dx, window.innerWidth - r.width - 6));
        const top = Math.max(6, Math.min(ev.clientY - dy, window.innerHeight - r.height - 6));
        state.pos = { left, top };
        wrap.style.cssText += `;left:${left}px;top:${top}px;right:auto;bottom:auto`;
      };
      const up = () => {
        handle.classList.remove('drag');
        handle.onpointermove = null;
        handle.onpointerup = null;
      };
      handle.onpointermove = move;
      handle.onpointerup = up;
    };
  }

  function escape(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function show(chart) {
    const same = state && state.chart.key === chart.key;
    state = {
      chart,
      unit: same ? state.unit : chart.targetUnit,
      pos: same ? state.pos : null,
      collapsed: same ? state.collapsed : false,
    };
    render();
  }

  function hide() {
    state = null;
    clear();
  }

  UB.panel = { show, hide, isShowing: () => !!state, current: () => state && state.chart.key };
})(typeof self !== 'undefined' ? self : globalThis);

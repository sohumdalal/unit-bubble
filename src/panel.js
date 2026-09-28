// The size-chart panel: a self-contained card that re-renders a detected chart
// in the unit you actually read, with a toggle back to the original. Lives in
// its own shadow root, so the host page's CSS can't reach it.
(function (root) {
  const UB = (root.UB = root.UB || {});

  const FONT = "'FerrariSans', -apple-system, system-ui, sans-serif";
  const BLUE = '#007aff';
  const BLUE_DARK = '#0a84ff';

  const CSS = `
    :host { all: initial; }
    .wrap {
      position: fixed; z-index: 2147483646;
      right: 24px; bottom: 24px; width: 372px; max-width: calc(100vw - 32px);
      box-sizing: border-box; border-radius: 16px; overflow: hidden;
      font: 400 13px/1.45 ${FONT};
      color: #101013; background: #fdfdfe;
      border: 1px solid rgba(0,0,0,.1);
      box-shadow: 0 2px 8px rgba(0,0,0,.07), 0 24px 56px -14px rgba(0,0,0,.4);
      opacity: 0; transform: translateY(10px); transition: opacity .16s ease, transform .2s cubic-bezier(.2,.8,.2,1);
    }
    .wrap.in { opacity: 1; transform: none; }
    header {
      display: flex; align-items: center; gap: 9px;
      padding: 12px 11px 12px 14px; border-bottom: 1px solid rgba(0,0,0,.08);
      cursor: grab; user-select: none;
    }
    header.drag { cursor: grabbing; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: ${BLUE}; flex: 0 0 auto; }
    h2 { margin: 0; font-size: 13px; font-weight: 500; letter-spacing: -.005em; flex: 1 1 auto; }
    h2 small { font-weight: 400; color: rgba(16,16,19,.42); }
    .seg { display: flex; padding: 2px; gap: 2px; border-radius: 8px; background: rgba(0,0,0,.055); flex: 0 0 auto; }
    .seg button {
      font: 500 11px/1 ${FONT}; letter-spacing: .02em;
      border: 0; border-radius: 6px; padding: 5px 9px; cursor: pointer;
      background: transparent; color: rgba(16,16,19,.5);
    }
    .seg button[aria-pressed="true"] { background: ${BLUE}; color: #fff; }
    .x {
      border: 0; background: transparent; cursor: pointer; flex: 0 0 auto;
      width: 24px; height: 24px; border-radius: 7px; color: rgba(16,16,19,.4);
      font: 400 15px/1 ${FONT};
    }
    .x:hover { background: rgba(0,0,0,.06); color: #101013; }
    .body { max-height: min(62vh, 520px); overflow: auto; padding: 2px 8px 8px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { padding: 8px 9px; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    th {
      position: sticky; top: 0; z-index: 1;
      font-size: 10.5px; font-weight: 500; letter-spacing: .04em; text-transform: uppercase;
      color: rgba(16,16,19,.42); background: #fdfdfe; border-bottom: 1px solid rgba(0,0,0,.09);
    }
    th:first-child, td:first-child { text-align: left; }
    td { font-size: 13.5px; border-bottom: 1px solid rgba(0,0,0,.055); }
    tr:last-child td { border-bottom: 0; }
    td.size { font-weight: 500; }
    tr.pick td { background: rgba(0,122,255,.1); }
    tr.pick td:first-child { box-shadow: inset 2.5px 0 0 ${BLUE}; }
    tr.pick td.hit { color: ${BLUE}; font-weight: 500; }
    .foot {
      display: flex; align-items: center; gap: 8px; justify-content: space-between;
      padding: 10px 14px 12px; border-top: 1px solid rgba(0,0,0,.08);
      font-size: 11.5px; color: rgba(16,16,19,.45);
    }
    .foot a { color: ${BLUE}; text-decoration: none; }
    .foot a:hover { text-decoration: underline; }
    .pill {
      position: fixed; z-index: 2147483646; right: 24px; bottom: 24px;
      display: flex; align-items: center; gap: 8px; padding: 10px 15px; border-radius: 999px;
      cursor: pointer; font: 500 12.5px/1 ${FONT};
      color: #fff; background: ${BLUE}; border: 0;
      box-shadow: 0 2px 8px rgba(0,0,0,.14), 0 12px 30px -10px rgba(0,60,140,.5);
    }
    .pill .dot { background: rgba(255,255,255,.9); }
    @media (prefers-color-scheme: dark) {
      .wrap { background: #1c1c1e; color: #f5f5f7; border-color: rgba(255,255,255,.13); }
      header, .foot { border-color: rgba(255,255,255,.1); }
      h2 small { color: rgba(245,245,247,.45); }
      th { background: #1c1c1e; color: rgba(245,245,247,.45); border-color: rgba(255,255,255,.12); }
      td { border-color: rgba(255,255,255,.07); }
      .dot, .seg button[aria-pressed="true"], .pill { background: ${BLUE_DARK}; }
      .seg { background: rgba(255,255,255,.1); }
      .seg button { color: rgba(245,245,247,.55); }
      .x { color: rgba(245,245,247,.45); }
      .x:hover { background: rgba(255,255,255,.1); color: #fff; }
      tr.pick td { background: rgba(10,132,255,.2); }
      tr.pick td:first-child { box-shadow: inset 2.5px 0 0 ${BLUE_DARK}; }
      tr.pick td.hit { color: #7ab8ff; }
      .foot, .foot a { color: rgba(245,245,247,.45); }
      .foot a { color: #7ab8ff; }
    }
    .foot select {
      font: 400 11.5px/1 ${FONT}; color: inherit; cursor: pointer;
      background: rgba(0,0,0,.05); border: 1px solid rgba(0,0,0,.1);
      border-radius: 7px; padding: 5px 7px; max-width: 150px;
    }
    td[data-role] { cursor: default; }
    td[data-role]:hover { background: rgba(0,122,255,.07); }
    .tip {
      position: fixed; z-index: 2147483647; pointer-events: none;
      padding: 7px 10px 8px; border-radius: 10px; white-space: nowrap;
      font: 400 11.5px/1.4 ${FONT};
      background: #101013; color: #fff;
      box-shadow: 0 2px 6px rgba(0,0,0,.2), 0 12px 32px -10px rgba(0,0,0,.55);
      opacity: 0; transform: translateY(3px); transition: opacity .1s ease, transform .12s ease;
    }
    .tip.in { opacity: 1; transform: none; }
    .tip b { display: block; font-size: 14px; font-weight: 500; font-variant-numeric: tabular-nums; }
    .tip span { color: rgba(255,255,255,.55); font-variant-numeric: tabular-nums; }
    .tip i { display: block; margin-top: 3px; font-style: normal; font-weight: 500; }
    .tip[data-tone="good"] i { color: #30d158; }
    .tip[data-tone="snug"] i { color: #ffd60a; }
    .tip[data-tone="tight"] i { color: #ff453a; }
    .tip[data-tone="relaxed"] i { color: #64d2ff; }
    .tip[data-tone="boxy"] i { color: #da8fff; }
    @media (prefers-color-scheme: dark) {
      .foot select { background: rgba(255,255,255,.08); border-color: rgba(255,255,255,.12); }
      .tip { background: #2c2c2e; }
      td[data-role]:hover { background: rgba(10,132,255,.12); }
    }
    @media (prefers-reduced-motion: reduce) { .wrap, .tip { transition: none; } }
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
    tip = null;
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
      <h2>Size chart <small>in ${unit === 'orig' ? (chart.sourceUnit === 'in' ? 'inches' : 'centimeters') : unit === 'in' ? 'inches' : 'centimeters'}</small></h2>
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
            .map((item, c) => {
              const hit = chart.pick && chart.pick.row === r && chart.pick.col === c ? ' class="hit"' : '';
              const role = chart.roles && chart.roles[c];
              const cmp = item && role && chart.values && chart.values[role] ? ` data-role="${role}" data-mm="${item.mm}"` : '';
              return `<td${hit}${cmp}>${escape(cellText(item, unit))}</td>`;
            })
            .join('')}</tr>`;
        })
        .join('')}</tbody>`;
    body.append(table);

    const foot = document.createElement('div');
    foot.className = 'foot';
    const options = UB.fit.PROFILES.map(
      (p) => `<option value="${p.id}"${p.id === chart.profileId ? ' selected' : ''}>${escape(p.short)}</option>`
    ).join('');
    const hasValues = chart.values && Object.keys(chart.values).length;
    const summary = chart.pick
      ? `Your ${UB.fit.FIELDS[chart.pick.role].label.toLowerCase()} → <strong>${escape(chart.pick.label)}</strong>${
          chart.pick.over ? ' · largest listed' : ''
        }`
      : hasValues
      ? 'No matching column on this chart'
      : '<a href="#" data-act="settings">Add your measurements</a>';
    foot.innerHTML = `<span>${summary}</span><select class="prof" title="Compare against">${options}</select>`;

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
    const settingsLink = foot.querySelector('[data-act=settings]');
    if (settingsLink) {
      settingsLink.onclick = (e) => {
        e.preventDefault();
        chrome.runtime.sendMessage({ type: 'openOptions' });
      };
    }
    foot.querySelector('.prof').onchange = (e) => {
      chart.setProfile(e.target.value);
      render();
    };
    wireTips(body, table);
    makeDraggable(wrap, head);

    if (state.collapsed) {
      clear();
      const pill = document.createElement('button');
      pill.className = 'pill';
      pill.innerHTML = `<i class="dot"></i> Size chart in ${chart.targetUnit === 'in' ? 'inches' : 'centimeters'}`;
      pill.onclick = () => {
        state.collapsed = false;
        render();
      };
      shadow.append(pill);
    }
  }

  // Hovering a cell answers the question the chart doesn't: how far off your own
  // measurement is this size, and what does that feel like when worn.
  let tip = null;

  function wireTips(body, table) {
    table.addEventListener('mouseover', (e) => {
      const td = e.target.closest && e.target.closest('td[data-role]');
      if (!td) return;
      const { chart, unit } = state;
      const role = td.dataset.role;
      const mine = chart.values[role];
      const diff = Number(td.dataset.mm) - mine;
      const v = UB.fit.verdict(role, diff);
      const shown = unit === 'orig' ? chart.sourceUnit : unit;
      showTip(
        td,
        `<b>${UB.fit.formatDiff(diff, shown)}</b><span>vs your ${
          shown === 'in' ? `${UB.format.num(mine / 25.4, 2)}″` : `${UB.format.num(mine / 10, 1)} cm`
        }</span>${v ? `<i>${v.text}</i>` : ''}`,
        v && v.tone
      );
    });
    table.addEventListener('mouseout', (e) => {
      if (!e.relatedTarget || !table.contains(e.relatedTarget)) hideTip();
    });
    body.addEventListener('scroll', hideTip, { passive: true });
  }

  function showTip(td, html, tone) {
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'tip';
      shadow.append(tip);
    }
    tip.innerHTML = html;
    if (tone) tip.dataset.tone = tone;
    else delete tip.dataset.tone;
    const r = td.getBoundingClientRect();
    tip.style.visibility = 'hidden';
    tip.classList.add('in');
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let top = r.top - h - 7;
    if (top < 6) top = r.bottom + 7;
    tip.style.top = `${Math.round(top)}px`;
    tip.style.left = `${Math.round(Math.max(6, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 6)))}px`;
    tip.style.visibility = 'visible';
  }

  function hideTip() {
    if (tip) tip.classList.remove('in');
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
      collapsed: same ? state.collapsed : chart.autoOpen === false,
    };
    render();
  }

  function hide() {
    state = null;
    clear();
  }

  UB.panel = { show, hide, isShowing: () => !!state, current: () => state && state.chart.key };
})(typeof self !== 'undefined' ? self : globalThis);

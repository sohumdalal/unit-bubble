// Injected into every mock store BEFORE the extension runs, in the page's own
// world. It records when our elements are added and removed, which is what
// makes flashing measurable instead of something you notice by eye.
module.exports = function watchScript() {
  const t0 = performance.now();
  const at = () => Math.round(performance.now() - t0);
  window.__ub = { events: [], panelWraps: 0, panelWatching: false };

  const kindOf = (node) => {
    if (node.nodeType !== 1) return null;
    if (node.classList.contains('ub-chip')) return 'chip';
    if (node.classList.contains('ub-cta')) return 'cta';
    if (node.classList.contains('ub-hit')) return 'hit';
    if (node.hasAttribute('data-ub-root')) return 'host';
    return null;
  };

  const record = (type, kind, extra = {}) => window.__ub.events.push({ t: at(), type, kind, ...extra });

  new MutationObserver((records) => {
    for (const r of records) {
      for (const node of r.addedNodes) {
        if (node.nodeType !== 1) continue;
        const inChart = !!(node.closest && node.closest('[data-ub-chart]'));
        const kind = kindOf(node);
        if (kind) record('add', kind, { inChart });
        // Our chip arrives inside its marker, and only the marker is reported.
        for (const inner of node.querySelectorAll ? node.querySelectorAll('.ub-chip,.ub-cta,.ub-hit') : []) {
          const innerKind = kindOf(inner);
          if (innerKind) record('add', innerKind, { inChart });
        }
      }
      for (const node of r.removedNodes) {
        const kind = kindOf(node);
        if (kind) record('remove', kind, {});
      }
    }
  }).observe(document, { childList: true, subtree: true });

  // The panel lives in a shadow root, so it needs its own observer once the
  // host exists. Every .wrap added is one full re-render of the panel.
  window.__ubWatchPanel = () => {
    if (window.__ub.panelWatching) return true;
    const host = [...document.querySelectorAll('[data-ub-root]')].find((h) => h.shadowRoot);
    if (!host) return false;
    window.__ub.panelWatching = true;
    new MutationObserver((records) => {
      for (const r of records) {
        for (const node of r.addedNodes) {
          if (node.nodeType === 1 && node.classList.contains('wrap')) {
            window.__ub.panelWraps += 1;
            window.__ub.events.push({ t: at(), type: 'add', kind: 'panel' });
          }
        }
      }
    }).observe(host.shadowRoot, { childList: true, subtree: true });
    return true;
  };
};

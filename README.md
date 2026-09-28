# Unit Bubble

A Chrome extension for shopping on sites that don't use your units.

Every price and measurement on the page carries a small blue chip with the
converted value, right where you're already looking — `€65.00 EUR $70.65`,
`63.5 cm 25.0″`. Hover a chip for the original and the exchange rate behind it.

Size charts get their own treatment: an **Open Chart** button next to the
store's own size guide, and a panel that re-renders the whole chart in your
units, with a toggle back to the original.

Lengths read in inches or centimeters; prices in any of 45 currencies. Values
already in your units are left alone, so a US store in dollars and inches stays
untouched.

## Install

Not on the Chrome Web Store yet — see [docs/release.md](docs/release.md).

```bash
git clone https://github.com/sohumdalal/unit-bubble
open -a "Google Chrome" --args --new-window chrome://extensions
```

Turn on **Developer mode**, choose **Load unpacked**, and pick the folder.

## Settings

Click the toolbar icon for the two you'll change while shopping — target length
unit and target currency — plus an off switch for the current site. **Settings**
opens the rest:

| Setting | Default | |
| --- | --- | --- |
| Lengths | Inches | Feet and inches above 3 ft |
| Prices | USD | 45 currencies |
| `$` / `¥` / `kr` mean | USD / JPY / SEK | Several countries share these symbols |
| Chips on prices / measurements | both on | Either can be turned off alone |
| Underline originals | off | A dotted line under the converted value |
| Open the panel on sight | off | On skips the button and opens immediately |
| Highlight my size | on | Needs your measurements |
| Your measurements | — | Per garment type; drives the highlight and hover verdicts |
| Never run on | — | Per-site off switch |

Fill in your measurements (from a garment that already fits, measured flat) and
the panel highlights your row and tells you how each size differs on hover:
`+1.6″ vs your 22.0″ · boxy`.

## Known bugs and limits

- **Charts that are images** (PNG/JPEG) can't be read. SVG charts can.
- **A chart behind a store's own modal** is only advertised if its markup is
  already in the page. If the store builds it on click, open their size guide
  first and the button appears above the chart.
- **Half of the stores offering a chart** open one we can't use — an image, a
  separate page, or a layout the reader rejects. Measured at 11 of 20 pages
  working on the last scan.
- **Unlabelled columns** show as `Col 2` when a chart's header can't be found.
- **Weight and temperature** aren't converted; lengths and prices only.
- **A bare `"` in prose** after a number under 1000 is read as inches, so a
  quoted `5"` converts.
- **A value in the middle of a sentence** is wrapped in place, which replaces
  that text node. A page holding its own reference to that node (rare in prose,
  common for prices — which are handled without replacing) would lose a later
  update to it.
- **`$` on a Canadian or Australian store** shows as your `$ means` choice until
  you change it; there are no per-site currency defaults.

## Contributing

```bash
npm install          # Playwright, for the browser tests
npm test             # 1000+ assertions, no browser, ~2s
npm run e2e          # 13 mock stores in a real Chromium
npm run check        # both
```

Then load the folder unpacked (above). After changing anything under `src/`,
press ⟳ on the extension card and reload the page you're testing.

**Found a page it gets wrong?** Add a mock store rather than a fix-by-eye:
copy the closest file in `test/e2e/sites/`, reproduce the markup that breaks,
and add a case to `test/e2e/run.js`. Guessing from screenshots has been wrong
more often than right here. Useful while you work:

```bash
npm run e2e -- --only svg --debug      # one case, with the reader explaining itself
HEADED=1 npm run e2e                   # watch it happen
node tools/scan/repro.js --url <page>  # drive one real page, step by step
```

To check a change against real stores:

```bash
npm run scan:discover                  # sitemaps -> ~3700 product URLs
npm run scan -- --limit 1000           # 1000 pages, no browser, ~70s
npm run scan:browser -- --limit 50     # 50 pages with the extension loaded
node tools/scan/perf.js --local        # scripting cost, against the mock stores
```

| | |
| --- | --- |
| `src/lib/` | detection, conversion, the chart reader, fit profiles — all testable in node |
| `src/content.js` | text walking, chips, the Open Chart button, chart wiring |
| `src/panel.js` | the size-chart panel |
| `src/background.js` | exchange rates |
| `test/e2e/` | mock stores and the suite that drives them |
| `tools/scan/` | scanners for real sites |
| `docs/internals.md` | how the chart reader works, and every bug worth remembering |

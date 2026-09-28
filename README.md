# Unit Bubble

A Chrome extension for shopping on sites that don't use your units. Every price
and measurement on the page carries a chip with the converted value, right where
you're already looking — `€65.00 EUR $74.00`, `63.5 cm 25.0″`. The chip is a
bright blue pill in its own type stack, so it never reads as part of the store's
own copy. Hover one for the original and the rate behind it.

Size charts get their own treatment: the whole chart is re-rendered in a floating
panel in your units, with a toggle back to the original.

Both directions are configurable: read lengths in inches or centimeters, and
prices in any of 45 currencies. Nothing is sent anywhere except one
exchange-rate fetch every 12 hours.

<img src="icons/128.png" width="64" alt="" />

## Load it

```bash
open -a "Google Chrome" --args --new-window chrome://extensions
```

1. Turn on **Developer mode** (top right).
2. **Load unpacked** → pick this directory.
3. Pin it, then open the test page:

```bash
open -a "Google Chrome" test/fixtures.html
```

Every value on that page should carry a chip, each of the three size charts
should raise the panel, and the two fields at the bottom must stay plain. After editing any file, hit reload on the extension card
and refresh the tab.

## Settings

Click the toolbar icon for the two settings that matter day to day — target
length unit and target currency — plus an off switch for the current site.
**Settings** opens the full page:

| Setting | Default | Notes |
| --- | --- | --- |
| Lengths | Inches | Under 3 ft shows plain inches, above it shows `6′ 0″` |
| Prices | USD | 45 currencies |
| `$` means | USD | Also `¥` (JPY or CNY) and `kr` (SEK / NOK / DKK / ISK) |
| Your measurements | — | Optional; highlights your row in the size-chart panel |
| Underline originals | off | A dotted underline under the original value, on top of the chip |
| Never run on | — | One domain per line |

Values already in your units get no chip, so a US page in inches and dollars
stays completely untouched.

## Size charts

A chart is the one place where chips would be noise — two dozen of them at once —
so charts are handled separately, in `src/lib/sizechart.js`.

The reader doesn't look at markup. On Shopify the chart is usually injected by an
app (brut-clothing uses Vitals), so it may be a `<table>`, a CSS grid, a row of
flex columns, or absolutely positioned divs, and none of that is knowable ahead
of time. Instead it takes every measurement it found, reads the on-screen
rectangle of each one, and clusters those rectangles back into rows and columns.
Headers and size labels are then picked up by alignment — whatever sits above a
column, or left of a row. Chips inside a detected chart are removed, and the
panel takes over.

What keeps a grid of product cards from being read as a chart is that **a size
chart's columns are monotonic**: every column climbs (or falls) as you go down
the sizes. At least 60% of columns must hold that, alongside a minimum of 3 rows,
2 columns, and 55% of slots filled.

Fill in your own measurements under Settings — measured flat, off a garment that
already fits — and the panel highlights the first row that isn't smaller than
you, which is how a flat-measurement chart is meant to be read. The panel is
draggable by its header, the ✕ collapses it to a pill, and the unit toggle flips
the whole chart at once.

## What it detects

- **Lengths** — `mm`, `cm`, `m`, `in`/`inch`/`inches`/`"`, `ft`/`feet`/`'`, and
  compound heights in both conventions: `5'10"` and the French `1m82`.
- **Prices** — symbol before or after the number (`€19,99`, `1 495 kr`,
  `zł129`), prefixed dollar and yen variants (`US$`, `C$`, `R$`, `CN¥`), and ISO
  codes on either side (`1.299,00 EUR`, `CHF 48.20`).
- **Both number formats** — `1,299.00` and `1.299,00` and `1 299`, resolved by
  separator position, with the currency as a tiebreaker on the genuinely
  ambiguous `1.299`.

Deliberately skipped: uppercase `M` (million, not metres), `290 GSM`, years
(`BRUT 2026`), decade apostrophes (`LOOKBOOK '26`), `in` inside words,
inputs, textareas and `contenteditable`, and anything already in your units.

## Rates

`open.er-api.com` (free, no key, USD base), cached in `storage.local` for 12
hours and refreshed on a 6-hour alarm. A bundled fallback table ships in
`src/lib/currencies.js` so the first hover works before the first fetch; the
bubble marks a rate as stale past 36 hours. **Refresh now** in either UI forces a
fetch.

## Layout

```
manifest.json          MV3, one content script on <all_urls>
src/lib/currencies.js  currency tables, symbol maps, fallback rates, defaults
src/lib/detect.js      number parsing + match finding (pure, node-testable)
src/lib/convert.js     match + settings -> the two lines of bubble text
src/lib/sizechart.js   geometric chart reader: rects -> grid, labels, size pick
src/panel.js           the size-chart panel (shadow DOM, draggable, unit toggle)
src/content.js         text walker, inline chips, chart wiring, the hover bubble
src/background.js      rate fetch, cache, alarm, message handler
src/popup.*            toolbar popup
src/options.*          settings page
test/detect.test.js    39 assertions on detection and conversion
test/sizechart.test.js 31 assertions on grid reconstruction, fed browser rects
test/fixtures.html     real-world strings plus three differently-built charts
tools/make-icons.js    regenerates icons/*.png
```

## Test

```bash
npm test
```

## Known edges

- Bare `"` after a number is read as inches, so a quoted `5"` in prose converts.
- `$` on a Canadian or Australian store shows as your `$ means` choice until you
  change it — per-site currency defaults aren't in yet.
- Weight (`kg` → `lb`) and temperature aren't handled; lengths and prices only.
- A chip adds text, so very tight layouts shift a little.
- Where a store prints the code after the price (`€65.00EUR`), the chip goes
  after the code — including when the code sits in its own element.
- Charts with fewer than 3 sizes, or a single measurement column, don't trip the
  panel — they stay as ordinary chips.

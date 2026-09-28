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
| Chips on prices / on measurements | both on | Either can be turned off on its own |
| Underline originals | off | A dotted underline under the value the chip converts |
| Open the panel automatically | on | Off means a pill you tap to open |
| Highlight my size | on | Needs your measurements |
| Your measurements | — | Per garment type; drives the highlight and the hover verdicts |
| Never run on | — | One domain per line |

Values already in your units get no chip, so a US page in inches and dollars
stays completely untouched.

## Size charts

A chart is the one place where chips would be noise — two dozen of them at once —
so charts are handled separately, in `src/lib/sizechart.js`.

The reader doesn't look at markup. On Shopify the chart is usually injected by an
app (brut-clothing uses Vitals), so it may be a `<table>`, a CSS grid, a row of
flex columns, absolutely positioned divs, or **inline SVG** — and none of that is
knowable ahead of time. Instead it takes every number it found, reads the
on-screen rectangle of each one, and clusters those rectangles back into rows and
columns. Headers and size labels are then picked up by alignment — whatever sits
above a column, or left of a row. Chips inside a detected chart are removed, and
the panel takes over.

Three things that break unit-detection alone, and are handled here:

- **Transposed charts.** Plenty of stores run sizes across the top and
  measurements down the side. Both directions are tested for order, and the grid
  is transposed when the rows are the ordered ones — so `cells` is always
  `[size][measurement]` whichever way the page wrote it.
- **Bare cells.** `25 1/2`, `23`, `24 1/4` with the unit stated once in a heading
  or not at all. Mixed fractions parse, and the unit is inferred: explicit units
  on the cells first, then the chart's own text (`in`, `inches`, `cm`), then
  magnitude — garment charts in inches sit well under 40, in centimetres well
  over it. If it lands between 35 and 45 the chart is skipped rather than
  guessed at, because a wrong unit is worse than no panel.
- **SVG text.** Real text with real rectangles, so it reads like a table.
  Nothing is ever injected into an SVG — a `<span>` there stops the text
  rendering at all.

Because bare numbers are everywhere on a page, a chart with no units in its
cells must also *look* like a chart: size-shaped row labels (`XS`…`XXL`, `36`,
`2XL`) or headers that name measurements.

What keeps a grid of product cards from being read as a chart is that **a size
chart's columns are monotonic**: every column climbs (or falls) as you go down
the sizes. At least 60% of columns must hold that, alongside a minimum of 3 rows,
2 columns, and 55% of slots filled.

A chart that only exists in the DOM until a modal opens has no rectangles to
cluster while it is hidden, and opening the modal adds no new text — it only
flips visibility. So detection is re-armed by visibility (an
`IntersectionObserver` on values that measured zero) and by attribute changes,
not by mutation alone.

The panel opens centred in the viewport, because a size chart is the thing you
went looking for — a corner is where you put something you might want later. It
is draggable by its header (which pins it where you drop it), `Esc` or the ✕
collapses it to a pill, and the unit toggle flips the whole chart at once. It
hides itself when the chart scrolls out of view or the store's modal closes.

### Fit

Measurements live per garment type — `tops`, `jackets`, `pants` — because a
chest that's right for a tee is wrong for a jacket you layer under. Fields and
thresholds are in `src/lib/fit.js`; which profile a chart uses is inferred from
its own columns first (an inseam column means pants), then the page's words, and
can be switched in the panel's footer.

With a profile filled in, the panel highlights the first row that isn't smaller
than you — how a flat-measurement chart is meant to be read — and **hovering any
cell** gives the difference from your own measurement plus what it means to
wear: `+1.6″ vs your 22.0″ · boxy`. Thresholds are per family, since a shoulder
seam 1″ out is a different problem from a sleeve 1″ out:

| Family | Fields | Reads as |
| --- | --- | --- |
| girth | chest, waist, hips, thigh | too tight · snug · spot on · roomy · boxy |
| width | shoulders, leg opening | too narrow · slightly narrow · spot on · wide · dropped shoulder |
| length | sleeve, body length, inseam, rise | too short · a touch short · spot on · a touch long · too long |
| neck | neck | too tight · snug · spot on · loose · very loose |

## What it detects

- **Lengths** — `mm`, `cm`, `m`, `in`/`inch`/`inches`/`"`, `ft`/`feet`/`'`, and
  compound heights in both conventions: `5'10"` and the French `1m82`.
- **Prices** — symbol before or after the number (`€19,99`, `1 495 kr`,
  `zł129`), prefixed dollar and yen variants (`US$`, `C$`, `R$`, `CN¥`), and ISO
  codes on either side (`1.299,00 EUR`, `CHF 48.20`).
- **Every number format** — `1,299.00`, `1.299,00`, `1 299,00` (plain, nbsp and
  narrow nbsp), Swiss `1'299.00`, and Indian lakh grouping `1,23,456`. Resolved
  by separator position, with the currency as a tiebreaker on the genuinely
  ambiguous `1.299`.

Deliberately skipped: uppercase `M` (million, not metres), bare `in` as a
preposition (`12 in the manual`, `1 in 4 people`), `290 GSM`, years
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
src/lib/fit.js         garment profiles, fit verdicts, profile detection
src/panel.js           the size-chart panel (shadow DOM, draggable, unit toggle)
src/content.js         text walker, inline chips, chart wiring, the hover bubble
src/background.js      rate fetch, cache, alarm, message handler
src/popup.*            toolbar popup: the two settings you change while shopping
src/options.*          settings page: everything, with a live chip sample
test/detect.test.js     43 assertions on detection and conversion
test/units.test.js      238 assertions: every unit spelling, every magnitude
test/currencies.test.js 545 assertions: every code, symbol and locale format
test/sizechart.test.js  72 assertions: grid reconstruction from browser rects,
                        orientation, unit inference, fit verdicts
test/pages.test.js      40 assertions: both pages booted against a DOM stub —
                        ids resolve, handlers survive being called, manifest
                        names files that exist
test/fixtures.html      real-world strings plus three differently-built charts
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
- A chart that is a **raster image** (PNG/JPEG) can't be read. SVG charts can.
  Reading pixels would need either a vision model call or a bundled OCR engine;
  neither is in here.

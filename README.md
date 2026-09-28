### A misdiagnosis worth recording

The last scan reported that 3sixteen's chart "produced 182 correct chips but was
not recognised as a chart". That was wrong. Driving the page with
`repro.js --debug` showed **3 chart-shaped cells on the whole page**: those 182
values are measurements inside prose sentences, not a grid, and they were
chipped correctly. The product page carries no chart at all — "Measuring Guide"
is `A.nav-link`, a link to a separate page.

Chasing it still turned up three real bugs:

- **"Measuring Guide" was not a size-guide label.** The patterns knew
  `measurements` but not `measuring`, so nothing offered to open it. `How to
  measure` and `Fit & Sizing` were missing too.
- **A hidden duplicate could win.** Stores repeat the same control in a mobile
  drawer and a footer; the first in document order was inside a collapsed
  drawer, so the button was placed where nobody could see it and clicking it did
  nothing. Visible controls are now preferred — which likely explains a share of
  "sometimes it shows up, sometimes it doesn't".
- **A link to another page is not an opener.** Recognising "Measuring Guide"
  immediately created a worse bug: a button promising the chart in your units
  that navigates away instead. An `<a>` whose href resolves to a different path
  is no longer treated as something to open, so a page whose only size-guide
  control is a nav link correctly gets no button.

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
| Open the panel on sight | off | On skips the Open Chart button and opens immediately |
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
went looking for — a corner is where you put something you might want later.

Getting in front of a store's own size-guide modal takes three things, and which
one matters depends on how that store built it: the maximum z-index, for a modal
that simply bids high; being last in DOM order, which breaks ties at equal
z-index against markup injected after us; and the top layer, which beats z-index
outright — entered through the popover API, or by living inside the `<dialog>`
when the store used a native modal one, whose descendants are also the only
things it doesn't make inert. All three are applied.

It sizes itself to the chart — `width: max-content` inside a flex column capped
at 94vh — so it scrolls only when a chart genuinely exceeds the screen. It is
draggable by its header (which pins it where you drop it), `Esc` or the ✕
dismisses it, and the unit toggle flips the whole chart at once. Dismissing
closes it outright rather than leaving a pill behind: the Open Chart button is
already the way back in, and two entry points at once is one too many.

The toggle always offers two real choices — the chart's own unit and the other
one — so a chart already in your units still opens, still converts the other
way, and still gives fit verdicts. Charts in your own units used to be skipped
entirely, which left the button and the toggle doing nothing on them.

Opening is driven by the chart coming into view; closing is not. The panel stays
until you dismiss it, because a store collapsing its own size guide shouldn't
take the conversions with it. It goes away on its own only when the chart's
element leaves the page entirely.

A centred panel also sits *outside* the store's modal in the DOM, which meant
every click on our own unit toggle read as a click-outside to the store and
dismissed its guide underneath us. Pointer and click events are stopped at the
shadow host — in the bubble phase, after they have reached our own buttons, so
they work but never reach the store's document listener. Re-appending the host
for DOM order happens only on open, too: moving a popover in the DOM closes it,
which is what made a unit toggle look like a dismissal.

### Knowing a chart is there

The button comes first: the panel doesn't open itself on sight unless you turn
that on. One **Open Chart** button appears, and what it does is read from
current state each time you click it — a parsed chart opens the panel; a chart
still hidden behind the store's modal opens that modal, and the pass that
follows raises the panel. (Behaviour used to be *rebound* as the extension
learned things, which let a later pass clobber it.)

Three things make it appear consistently, all of which it first got wrong:

- **It doesn't wait for evidence of a chart.** A size-guide label *is* the
  evidence — that is what the label is for. Waiting to find hidden chart cells
  first tied the button to how far the page had hydrated, which is why it often
  needed a refresh to show up.
- **Labels are normalised before matching.** A store's label is rarely just its
  words: an accordion adds a `+` when it hydrates, a link adds a `›`, and those
  arrive after first paint. Normalisation keeps letters, digits and `&` and drops
  everything else — a strip-list was tried first and missed U+2212 MINUS SIGN.
- **Detection re-runs on a schedule** — 300ms, 900ms, 2s and 4.5s after start,
  plus `load` and every return to the tab — because a Shopify page injects its
  size guide well after `document_idle`, and mutation records alone proved
  unreliable.

Placement is recomputed on every pass, so it self-corrects rather than being
one-shot:

- **Chart on screen** (the store's guide is open): above the chart, inside that
  modal — the store's own size-guide link is *behind* the modal and invisible
  from there.
- **Chart not on screen**: beside the control that opens the store's guide.
  After a block-level label the button is appended *inside* it, so it sits on
  the same line as the text instead of shoving the page down a line, and it is
  deliberately small (11px, a 5px dot) so it reads as a note on the store's own
  label rather than a button competing with it.

Two questions that were once conflated into a single "trigger", and are now
kept apart:

- **What it does** needs a control that genuinely opens a chart — an explicit
  "size chart" or "size guide". A "SIZE AND FIT" accordion mentions sizing but
  opens nothing, so clicking it did nothing at all: it only toggled the
  accordion, and even that was swallowed by our own `stopPropagation`.
- **Where it goes** is that control, or the chart itself once on screen.

Nothing is cached between passes. The first version kept whichever label matched
first during hydration — the accordion, which exists before the store's real
"Size Guide" link does — and never reconsidered. And the button now only exists
when it has something to do: with no opener and no parsed chart it is removed
rather than left dead.

There is only ever one button; it is moved, never duplicated.

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
- **Fractions, both notations** — `25 1/2 in` and the vulgar fractions US charts
  actually use: `17¼`, `28⅞`, `33¾`.

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
test/units.test.js      251 assertions: every unit spelling, every magnitude
test/currencies.test.js 553 assertions: every code, symbol and locale format
test/sizechart.test.js  147 assertions: grid reconstruction from browser rects,
                        orientation, unit inference, fit verdicts, label matching
test/e2e/*              end-to-end suite and its mock stores — see End to end
tools/scan/*            scanners for real sites — see Scanning real sites
test/pages.test.js      38 assertions: both pages booted against a DOM stub —
                        ids resolve, handlers survive being called, manifest
                        names files that exist
test/fixtures.html      real-world strings plus three differently-built charts
tools/make-icons.js    regenerates icons/*.png
```

## Test

```bash
npm test
```

## End to end

```bash
npm run e2e                  # all cases
npm run e2e -- --only svg    # cases matching a name
npm run e2e -- --debug       # print what the reader decided, on failure
HEADED=1 npm run e2e         # watch it happen
npm run check                # unit suites + end to end
```

Thirteen mock stores in `test/e2e/sites`, served over real HTTP, each built out
of a pattern that has actually broken this extension: a chart in a modal opened
by a bare `<span>`; vulgar fractions and a `$0` placeholder; a transposed chart
of unitless cells; an SVG chart; a page where nothing exists at
`document_idle`; a page that re-renders itself every second; a page of prose
that must be left completely alone; a native modal `<dialog>`; a CSS grid with
French labels; a page of decoy controls (a nav link to another page, and a
hidden duplicate in a collapsed drawer); a page whose only size-guide control is
a nav link; and one page carrying twelve currency formats at once.

Each case drives the real extension in a real Chromium — clicking the store's
own controls, our button, the unit toggle, the dismiss — and asserts on the
resulting UI: chip values, chart recognition, headers, size labels, the row it
picks for your measurements, hover verdicts, panel renders, page errors.

**Flashing is measured, not eyeballed.** A script injected before the extension
records every time one of our elements is added or removed, so a case can assert
that no chip was ever added and then taken away, that the button was created at
most once and never removed, and that two toggle clicks cause exactly two panel
renders. That is what a flash is: something appearing and then being withdrawn.

Rates are pinned through the extension's own service worker, so price
assertions are exact rather than dependent on what the live endpoint says today.

### What the first run found

Thirteen cases, 170 checks. Six real bugs in the first two runs:

| Bug | Cause |
| --- | --- |
| A chart column rendered in feet — `96 cm` as `3′ 1.8″` | the height formatter's 3ft rule applied inside a chart |
| A numeric size column (`36`, `38`, `40`) read as a measurement, shifting every value one column left | nothing distinguished a size column from a measurement column |
| A prose sentence merged into the chart below it | on a depth tie the *larger* container won |
| Our own button read as a column header | label collection skipped the panel and chips, but not the button |
| **Chips sprayed across a chart and stripped a moment later** — the flash when a size guide opens | deferred cells were chipped on a timer whether or not they were visible, so a chart still hidden behind a modal got chips on every cell |
| `Shoulders (A)` missing as a header | headers were matched to columns by centre distance; a long right-aligned header lines up at its right edge, and its centre missed by 33px |
| `DESCRIPTION` and `SIZE AND FIT` used as size labels | labels were chosen by geometry alone, and a modal sits on top of a page whose own headings are therefore "near" the chart |

The last two are the interesting ones. Headers now match a column by how much
of their horizontal **span** they share, and labels are restricted to the
chart's own visual container — the nearest overlay, dialog or scroll box — so
text from behind a modal can't be mistaken for part of the chart.

## Scanning real sites

Unit tests say the arithmetic is right. They can't say whether a real store's
markup defeats the detector — so there are two scanners in `tools/scan`, and
they are where several of the bugs above came from.

```bash
npm run scan:discover          # domains -> product URLs, from each site's sitemap
npm run scan                   # thousands of pages, no browser
npm run scan:browser -- --limit 25 --length cm --currency EUR
```

**`scan:discover`** reads the sitemap of each domain in `tools/scan/sites.txt`
and writes product URLs to `tools/scan/urls.txt` — that is how a few dozen
domains become 1000+ pages. Product pages, not homepages: a homepage says
nothing about whether the extension works.

**`npm run scan`** is the mode that scales. It fetches the HTML, decodes the
entities a browser would, and runs the extension's own detector over the text —
no browser, ~8 pages a second. It reports what was found, what looked wrong
(implausible amounts, overlapping matches, missing rates), and **which numeric
strings it walked past**, which is the part worth reading: that list is where
missing patterns show up. Two of them did, on the first run of 60 pages:

| Found by the scan | Was |
| --- | --- |
| `17¼`, `33¾`, `28⅞` on 3sixteen | unparsed — vulgar fractions weren't supported at all |
| `$0` on every 3sixteen page | converted to a `€0.00` chip |

**`npm run scan:browser`** loads the real extension into a real Chromium and
checks what it actually did to the page. It drives the extension's settings
through its own service worker, so you can point it at units the pages *aren't*
already in — a US store read in USD and inches correctly does nothing, which
tests very little.

There is no ground truth for "the right conversion" on a stranger's website, so
it checks invariants that must hold whatever the page contains:

1. a chip's **length** conversion is exactly right (lengths need no rates);
2. a chip's **price** is within 20% of the bundled rate — enough to catch a
   wrong currency or a factor of 100, not a stale rate;
3. no chip inside an `<input>`, `<textarea>`, `contenteditable`, or `<svg>`;
4. the original value is left intact inside its marker;
5. chips don't multiply on a second look, and don't vanish unexplained — a
   chart being found legitimately strips the chips inside it;
6. the extension logged no errors;
7. where a size-guide control exists, the Open Chart button exists.

Both scanners exit non-zero when anything fails, so either can gate a commit.
They walk other people's shops: concurrency is capped at six, the User-Agent
says what it is, and a scan is not an excuse to hammer anyone.

### Reproducing an interaction

```bash
node tools/scan/repro.js [--url ...] [--headed]
```

Drives one page through the interactions that kept breaking — open the store's
guide, click Open Chart, work the unit toggle, dismiss, reopen — and prints the
state of our own UI at each step. Both shadow roots are `open` specifically so
this can read the panel; `closed` bought nothing, since a page can already see
the host element and CSS can't pierce a shadow root either way.

It earned itself immediately. Two bugs that survived three attempts at guessing
from screenshots took one run to find:

- brut's "Size Guide" is a bare `<span>` with **no attributes at all** — no
  role, no tabindex, no onclick. Its only tells are `cursor: pointer` and its
  parent's class. The opener scan only looked at `a`/`button`/`summary`/
  `[role=button]`, found nothing, and removed the button as dead.
- A chart cell carried no copy of its own text, so asking the panel for the
  chart in its original units threw inside `render()`. That took the panel down
  mid-draw and left `state.unit` on `'orig'`, so **every later open threw too** —
  the panel could never be opened again after one dismissal.

The second one hid for so long because the browser scan filtered page errors by
name, and a `TypeError` about `'replace'` names neither the extension nor any of
its symbols. Both scanners now report every page error.

### Flashing

Four separate causes, all of them something appearing and then being taken away:

- **Chips across a chart.** Every cell got a chip, and they were stripped a
  frame later once the chart was recognised. A text node that is nothing but one
  measurement now waits for the detection pass; if no chart claims it, it gets
  its chip 180ms later.
- **The panel.** `show()` re-rendered on every intersection — scrolling, a modal
  toggling, returning to the tab — and each render replayed the fade-in. It is a
  no-op now when the same chart is already displayed intact.
- **The button moving.** It was re-placed on every pass as the store opened and
  closed its modal, hopping between "above the chart" and "beside the label". A
  placed, visible button is now left alone.
- **The button being removed.** With no opener found it was deleted, then
  recreated on the next pass that found one. With a parsed chart in hand it
  always has something to do, so it stays.

### Still open, from the last scan

3sixteen's chart produced 182 correct chips but was **not** recognised as a
chart, so it got chips instead of the panel. The reader is finding the values
and rejecting the grid; the browser scan will say when that's fixed.

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

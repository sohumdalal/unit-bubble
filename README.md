# Unit Bubble

A Chrome extension for shopping on sites that don't use your units. Hover a price
or a measurement anywhere on the page and a small bubble appears next to it with
the value converted — `63.5 cm` → `25.00 in`, `€79,90` → `$86.85`. Nothing is
injected into the page layout, nothing is clicked, nothing is sent anywhere
except one exchange-rate fetch every 12 hours.

Both directions are configurable: read lengths in inches or centimeters, and
prices in any of 45 currencies.

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

Everything underlined on that page should raise a bubble; the two fields at the
bottom must stay plain. After editing any file, hit reload on the extension card
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
| Underline values | on | Off means bubbles still work, with no visible marking |
| Never run on | — | One domain per line |

Values already in your units raise no bubble, so a US page in inches and dollars
stays completely untouched.

## What it detects

- **Lengths** — `mm`, `cm`, `m`, `in`/`inch`/`inches`/`"`, `ft`/`feet`/`'`, and
  compound `5'10"`.
- **Prices** — symbol before or after the number (`€19,99`, `1 495 kr`,
  `zł129`), prefixed dollar and yen variants (`US$`, `C$`, `R$`, `CN¥`), and ISO
  codes on either side (`1.299,00 EUR`, `CHF 48.20`).
- **Both number formats** — `1,299.00` and `1.299,00` and `1 299`, resolved by
  separator position, with the currency as a tiebreaker on the genuinely
  ambiguous `1.299`.

Deliberately skipped: uppercase `M` (million, not metres), `in` inside words,
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
src/content.js         text walker, marker spans, the hover bubble (shadow DOM)
src/background.js      rate fetch, cache, alarm, message handler
src/popup.*            toolbar popup
src/options.*          settings page
test/detect.test.js    36 assertions, no browser: npm test
test/fixtures.html     local page of real-world strings to hover
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

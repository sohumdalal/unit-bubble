# Before it ships

Status of a Chrome Web Store release, honestly.

## Blocking — all of it yours, none of it code

1. **Register as a Chrome Web Store developer** — a one-off $5 fee.
2. **Create the item** and upload `unit-bubble.zip` (`npm run zip`).
3. **Paste the listing** from [`../store/listing.md`](../store/listing.md):
   name, short and long description, category, the five permission
   justifications, the single-purpose statement, and the privacy policy URL.
   The data-usage disclosures are all "nothing collected".
4. **Upload the five screenshots** from `../store/screenshots`, with the
   captions in that file.
5. **Publish as Unlisted** — installable by link, still reviewed, not
   searchable. A rough edge then isn't a public first impression.

Written and packaged already: the policy (`PRIVACY.md`, which GitHub hosts at a
URL the store accepts), all the copy, and the screenshots.

## Not blocking, but decide before shipping

- **Half of the charts on offer don't open.** The last 50-page scan measured 11
  of 20 pages where the button appeared and the panel worked. The rest open an
  image, a separate page, or a layout the reader turns down. The button is
  already truthful — it only appears with evidence of a readable chart — so the
  question is whether 55% is a good enough first impression.
- **Raster charts.** The single biggest gap, and the only one that needs
  something new: a vision model call or a bundled OCR engine.
- **`Col 2` headers.** When a chart's header can't be read, the column shows as
  `Col 2`. It's honest but looks unfinished.

## Fixed on the way here, worth knowing

- **A store's own price could go stale.** Marking replaced the page's text
  node, so a store holding a reference to it — React updates text exactly that
  way — wrote its price update into a detached node. The shopper would see the
  old price with our chip beside it. A value that is the whole of its node is
  now wrapped by *moving* the node, so the page keeps the object it owns, and a
  text change refreshes or removes our chip.
- **A price rendered as `$0.00` first was never converted.** The node was
  skipped as a zero price and remembered as seen, and a later text change never
  brought it back. Both found by the completeness check in the browser scan,
  which asks whether anything convertible is still sitting there unconverted.

## Cleared

- **Performance.** Measured against the mock stores, median of 3 runs: +8ms to
  +20ms of scripting on a normal product page. A deliberately pathological
  catalogue page (6,600 nodes, 1,200 chips) costs +270ms spread across idle
  slices, with **no long tasks at all** — nothing a user can feel.
- **Correctness at scale.** 1000 real product pages: 18,746 prices and 12,594
  measurements found across 14 currencies, **zero suspicious matches** after
  bounding quote marks. An earlier run of the same 1000 had 2,359.
- **No errors of ours in the wild.** 50 real pages driven with the extension
  loaded: 0 page errors attributable to us (the stores themselves threw 338),
  and every invariant held — exact length conversions, prices within tolerance,
  nothing marked inside inputs or SVG, no double-marking.
- **No remote code.** Nothing is loaded at runtime; the only network request is
  the rate fetch. This is what usually trips up a review.

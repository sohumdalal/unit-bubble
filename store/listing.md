# Chrome Web Store listing

Everything to paste, in the order the dashboard asks for it. Upload
`unit-bubble.zip` (built by `npm run zip`).

Publish as **Unlisted** first: installable by anyone with the link, still
reviewed, but not searchable — so a rough edge isn't a public first impression.

---

## Name

```
Unit Bubble
```

## Short description (132 max — this is 121)

```
Converts prices and measurements on any store into the units you read in, and rebuilds size charts in inches or cm.
```

## Category

`Shopping`

## Detailed description

```
Unit Bubble is for shopping on sites that don't use your units.

Every price and measurement on the page gets a small blue chip with the converted value, right where you're already looking — €65.00 becomes €65.00 $70.65, and 63.5 cm becomes 63.5 cm 25.0″. Hover a chip to see the original and the exchange rate behind it.

SIZE CHARTS

Size charts get their own treatment. An "Open Chart" button appears next to the store's own size guide, and opens the whole chart rebuilt in your units, with a toggle back to the original.

The reader doesn't depend on how a store built its chart. It works on tables, CSS grids, flex columns and inline SVG; on charts written the other way round, with sizes across the top; and on charts of bare numbers like 25 1/2 or 17¼ where the unit is stated once in a heading, or not at all.

Enter your own measurements — taken flat, from a garment that already fits — and the panel highlights your row and tells you how each size differs when you hover it: "+1.6″ vs your 22.0″ · boxy". Measurements are kept per garment type, because a chest that suits a tee is wrong for a jacket you layer over one.

PRICES

45 currencies. Symbols before or after the amount, prefixed variants like US$, C$, R$ and CN¥, and ISO codes on either side. Every number format: 1,299.00 and 1.299,00 and 1 299,00, Swiss 1'299.00, and Indian lakh grouping 1,23,456. You choose what $, ¥ and kr mean when a page doesn't say.

Rates come from a public exchange-rate service once every 12 hours.

QUIET BY DEFAULT

Values already in your units are left completely alone, so a US store in dollars and inches looks untouched. Inputs, text boxes and anything you can type into are never modified. You can turn chips off for prices or measurements separately, or switch the extension off for a single site from the toolbar.

PRIVACY

Nothing is collected. No analytics, no account, no telemetry. Page text is read in your browser to convert it and is never sent anywhere. The only network request is for the rate table, and it carries no information about you or what you're reading. No remote code is loaded.

Open source: github.com/sohumdalal/unit-bubble
```

## Privacy practices tab

**Single purpose**

```
Convert prices and measurements that appear on a web page into the units and currency the user has chosen to read in, and present a store's size chart in those units.
```

**Why "Read and change all your data on all websites"?**

```
The extension converts prices and measurements on shopping sites, and a shopper cannot know in advance which store they will open — so it must be able to read page text on any site. It reads visible text only, in the browser, to find values worth converting, and adds a small label next to them. Nothing is transmitted. It never reads form inputs, password or payment fields, or contenteditable areas; those are explicitly skipped.
```

**Why `storage`?**

```
To remember the user's chosen units, currency, per-site preferences and optional body measurements, and to cache the exchange-rate table so rates are fetched once every 12 hours rather than on every page.
```

**Why `alarms`?**

```
To refresh the exchange-rate table on a 12-hour schedule in the background, rather than making a network request while the user is browsing.
```

**Why `activeTab`?**

```
So the toolbar popup can offer an "off on this site" switch for the site currently open. It is used only when the user clicks the extension's icon.
```

**Why the host permission for `open.er-api.com`?**

```
This is the public exchange-rate endpoint the extension fetches its rate table from. The request contains no user data.
```

**Data usage disclosures** — check nothing. Then tick all three certifications:

- I do not sell or transfer user data to third parties, outside of approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL**

```
https://github.com/sohumdalal/unit-bubble/blob/main/PRIVACY.md
```

## Screenshots

In `store/screenshots`, all 1280×800, captured by `npm run shots` through the
same harness that runs the tests — so they show the extension actually working.

| File | Caption to paste |
| --- | --- |
| `01-chips.png` | Every price and measurement carries its converted value |
| `02-panel.png` | The store's size chart, rebuilt in your units |
| `03-fit-verdict.png` | Hover any cell to see how it compares to your own measurements |
| `04-fractions.png` | Charts written in 17¼ or 25 1/2, read into centimetres |
| `05-settings.png` | Per-garment measurements, and what $ should mean |

## Not needed

- A promotional tile is optional for an unlisted item; the 128px icon is enough.
- No paid features, so no merchant account.

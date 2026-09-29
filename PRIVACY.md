# Privacy policy — Unit Bubble

_Last updated: 29 September 2026_

**Unit Bubble collects nothing.** No analytics, no accounts, no telemetry, no
identifiers, no page content sent anywhere.

## What it reads

The extension reads the visible text of pages you open, in your browser, to
find prices and measurements and show converted values next to them. That text
is never transmitted, stored or logged. It is read in memory, on your machine,
and discarded when the page closes.

## What it stores

On your own device only:

- **Your settings** — target unit and currency, what `$` / `¥` / `kr` should
  mean, which sites to skip, and any measurements you choose to enter. Held in
  Chrome's `storage.sync`, which means Chrome may sync them between your own
  signed-in browsers. That is Chrome's sync, not ours; we never see it.
- **A table of exchange rates** and when it was fetched, held in
  `storage.local`.

## The one network request

Every 12 hours the extension requests current exchange rates from
`https://open.er-api.com/v6/latest/USD`.

That request contains **no user data** — no page URL, no page content, no
identifier, no settings. It is a plain public request for a rate table, the
same one for every user. It carries whatever your browser normally sends
(your IP address and user agent), and it happens in the background whether or
not you are browsing a store. See
[open.er-api.com](https://www.exchangerate-api.com/docs/free) for that
service's own terms.

If the request fails, the extension falls back to a rate table bundled in the
code and keeps working.

## What it never does

- Send page content, URLs, or browsing history anywhere
- Load or run remote code
- Show ads, inject affiliate links, or alter prices, links or checkout
- Read passwords, payment fields, form inputs or `contenteditable` areas — these
  are explicitly skipped

## Permissions, and why

| Permission | Why |
| --- | --- |
| Access to all sites | A shopper cannot know in advance which store they will open. Page text is read only to convert it, locally. |
| `storage` | To keep your settings and the cached rate table. |
| `alarms` | To refresh rates every 12 hours instead of on every page. |
| `activeTab` | So the toolbar popup can offer "off on this site" for the site you are looking at. |

## Removal

Uninstalling removes everything stored locally. There is nothing on a server to
delete, because nothing was ever sent to one.

## Contact

Open an issue at
[github.com/sohumdalal/unit-bubble](https://github.com/sohumdalal/unit-bubble/issues).

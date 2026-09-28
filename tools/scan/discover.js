#!/usr/bin/env node
// Turns a short list of domains into a long list of product URLs, by reading
// each site's sitemap. Shopify and most modern storefronts publish one, and
// product pages are where measurements and prices actually live — a homepage
// tells you nothing about whether the extension works.
//
//   node tools/scan/discover.js [--per 60] [--sites tools/scan/sites.txt]
//
// Writes tools/scan/urls.txt.
const fs = require('fs');
const path = require('path');

const args = require('./lib/args.js')();
const PER_SITE = Number(args.per || 60);
const SITES = args.sites || path.join(__dirname, 'sites.txt');
const OUT = args.out || path.join(__dirname, 'urls.txt');
const { pool, get, UA } = require('./lib/fetch.js');

const PRODUCT = /\/(products?|product-page|shop|item|p)\//i;

function sitemapsOf(domain) {
  return [`https://${domain}/sitemap.xml`, `https://${domain}/sitemap_index.xml`, `https://${domain}/robots.txt`];
}

// Shopify's sub-sitemaps carry query strings — sitemap_products_1.xml?from=…&to=…
// so the link has to be recognised without anchoring on ".xml", and the
// entities in it decoded.
const locs = (xml) =>
  [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) =>
    m[1].replace(/&amp;/g, '&').replace(/&#38;/g, '&')
  );

const isSitemap = (url) => /sitemap[^/?]*\.xml/i.test(url) || /\.xml(\?|$)/i.test(url);

async function discover(domain) {
  const found = new Set();
  const queue = sitemapsOf(domain);
  const seen = new Set();

  while (queue.length && found.size < PER_SITE) {
    const url = queue.shift();
    if (seen.has(url) || seen.size > 30) continue;
    seen.add(url);
    const res = await get(url);
    if (!res.ok) continue;

    if (url.endsWith('robots.txt')) {
      for (const m of res.body.matchAll(/^\s*Sitemap:\s*(\S+)/gim)) queue.push(m[1]);
      continue;
    }
    for (const loc of locs(res.body)) {
      if (isSitemap(loc)) {
        // Product sitemaps first; a large store's index holds dozens.
        if (/product/i.test(loc)) queue.unshift(loc);
        else if (queue.length < 6) queue.push(loc);
      } else if (PRODUCT.test(loc)) {
        found.add(loc.split('?')[0]);
        if (found.size >= PER_SITE) break;
      }
    }
  }
  return { domain, urls: [...found] };
}

async function main() {
  const domains = fs
    .readFileSync(SITES, 'utf8')
    .split('\n')
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter(Boolean);

  console.log(`Reading sitemaps for ${domains.length} domains (up to ${PER_SITE} product URLs each)\n`);
  const results = await pool(domains, 6, async (domain) => {
    try {
      const out = await discover(domain);
      console.log(`  ${out.urls.length ? '✓' : '·'} ${domain.padEnd(28)} ${out.urls.length} urls`);
      return out;
    } catch (err) {
      console.log(`  ✗ ${domain.padEnd(28)} ${err.message}`);
      return { domain, urls: [] };
    }
  });

  const all = results.flatMap((r) => r.urls);
  fs.writeFileSync(OUT, all.join('\n') + '\n');
  console.log(`\n${all.length} product URLs from ${results.filter((r) => r.urls.length).length} domains → ${OUT}`);
  console.log(`User-Agent used: ${UA}`);
}

main();

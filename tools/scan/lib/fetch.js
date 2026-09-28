// Small fetch helpers: a concurrency pool, a timeout, and one honest
// User-Agent. Concurrency is deliberately low — this walks other people's
// shops, and a scan is not an excuse to hammer them.
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/131.0 Safari/537.36 UnitBubbleScan/1.0 (+https://github.com/sohumdalal/unit-bubble)';

async function get(url, { timeout = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml' },
    });
    const body = res.ok ? await res.text() : '';
    return { ok: res.ok, status: res.status, body, url: res.url };
  } catch (err) {
    return { ok: false, status: 0, body: '', url, error: err.name === 'AbortError' ? 'timeout' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function pool(items, size, worker) {
  const out = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

module.exports = { get, pool, UA };

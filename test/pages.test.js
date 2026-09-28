// Run with: node test/pages.test.js
// Smoke-tests the two extension pages against a minimal DOM and chrome stub.
// It won't catch a layout problem, but it does catch what actually keeps
// reaching the browser: a reference to something that no longer exists, an id
// the HTML doesn't have, and a handler that throws on first use.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0;
const fails = [];
const rejections = [];
process.on('unhandledRejection', (err) => rejections.push(err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : String(err)));
const check = (name, got, want) =>
  got === want ? pass++ : fails.push(`${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`);
const ok = (name, cond, detail = '') => (cond ? pass++ : fails.push(`${name}${detail ? '\n    ' + detail : ''}`));

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// Never let a missing id throw: a renamed element should fail a check, not take
// the whole suite down with it.
const el = (doc, id) => doc.byId.get(id) || { innerHTML: '', textContent: '', value: '' };

/* ---------- a DOM small enough to read, large enough to boot a page ------- */

// Elements the page creates by assigning innerHTML have to exist afterwards,
// or the stub can't reach the code that fills them in.
function parseTags(html, tag) {
  return [...String(html).matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'g'))].map((m) => {
    const el = makeElement();
    for (const [, name, value] of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) {
      if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        el.dataset[key] = value;
      } else if (name === 'value') el.value = value;
      else if (name === 'id') el.id = value;
    }
    return el;
  });
}

function makeElement(id = '', doc = null) {
  let html = '';
  const el = {
    id,
    value: '',
    checked: false,
    disabled: false,
    textContent: '',
    innerHTML: '',
    hidden: false,
    dataset: {},
    style: {},
    children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    append() {},
    remove() {},
    setAttribute() {},
    getAttribute: () => null,
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    closest: () => null,
    getBoundingClientRect: () => ({ top: 0, bottom: 10, left: 0, right: 10, width: 10, height: 10 }),
    querySelector: () => null,
    querySelectorAll: (sel) => {
      const tag = /input/.test(sel) ? 'input' : /button/.test(sel) ? 'button' : /select/.test(sel) ? 'select' : null;
      return tag ? parseTags(html, tag) : [];
    },
    onchange: null,
    onclick: null,
    onkeydown: null,
  };
  Object.defineProperty(el, 'innerHTML', {
    get: () => html,
    set(value) {
      html = String(value);
      if (doc) doc.register(html);
    },
  });
  return el;
}

function makeDocument(html) {
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  const byId = new Map();
  const doc = {
    ids,
    byId,
    register(markup) {
      for (const [, id] of String(markup).matchAll(/id="([^"]+)"/g)) {
        if (!byId.has(id)) byId.set(id, makeElement(id, doc));
      }
    },
    getElementById: (id) => byId.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => makeElement('', doc),
    createRange: () => ({ selectNodeContents() {}, getBoundingClientRect: () => ({ width: 0, height: 0 }) }),
    createTreeWalker: () => ({ nextNode: () => null, currentNode: null }),
    addEventListener() {},
  };
  doc.documentElement = makeElement('html', doc);
  doc.body = makeElement('body', doc);
  for (const id of ids) byId.set(id, makeElement(id, doc));
  return doc;
}

function makeChrome({ stored = {}, local = {}, version = '0.0.0' } = {}) {
  const calls = [];
  return {
    calls,
    api: {
      runtime: {
        getManifest: () => ({ version }),
        sendMessage: (msg, cb) => {
          calls.push(msg);
          const res = msg.type === 'getRates' ? { rates: { USD: 1, EUR: 0.9 }, fetchedAt: Date.now() } : {};
          if (cb) cb(res);
          return Promise.resolve(res);
        },
        openOptionsPage: () => calls.push({ type: 'openOptionsPage' }),
        onMessage: { addListener() {} },
      },
      storage: {
        sync: {
          get: (key, cb) => (cb ? cb({ settings: stored }) : Promise.resolve({ settings: stored })),
          set: (obj, cb) => {
            calls.push(obj);
            if (cb) cb();
            return Promise.resolve();
          },
        },
        local: {
          get: (key, cb) => (cb ? cb(local) : Promise.resolve(local)),
          set: () => Promise.resolve(),
        },
        onChanged: { addListener() {} },
      },
      tabs: { query: async () => [{ url: 'https://brut-clothing.com/products/tee' }] },
    },
  };
}

function runPage({ htmlFile, scriptFile, stored, local, version }) {
  const html = read(htmlFile);
  const document = makeDocument(html);
  const stub = makeChrome({ stored, local, version });
  const context = {
    document,
    chrome: stub.api,
    window: {},
    location: { reload() {}, hostname: 'brut-clothing.com' },
    console,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (fn) => fn(),
    Intl,
    Math,
    Date,
    JSON,
    Number,
    String,
    Object,
    Array,
    Set,
    Map,
    RegExp,
    Promise,
    confirm: () => false,
  };
  context.globalThis = context;
  context.window = context;
  context.self = context;
  const sandbox = vm.createContext(context);

  // The scripts the page loads, in the order the HTML loads them.
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  const errors = [];
  for (const src of scripts) {
    try {
      vm.runInContext(read(path.join('src', src)), sandbox, { filename: src });
    } catch (err) {
      errors.push(`${src}: ${err.message}`);
    }
  }
  return { document, chrome: stub, errors, scripts, sandbox: context };
}

/* ---------- settings page ---------- */

// init() awaits chrome.storage, so let the microtask queue drain before asking
// what the page rendered.
const flush = () => new Promise((r) => setTimeout(r, 0));

async function main() {
let seenRejections = 0;
const newRejections = () => rejections.slice(seenRejections).join(' | ');
const markRejections = () => (seenRejections = rejections.length);

const opts = runPage({
  htmlFile: 'src/options.html',
  scriptFile: 'src/options.js',
  stored: { length: 'in', currency: 'USD', profiles: { tops: { chest: 56 }, jackets: {}, pants: {} } },
  local: { rates: { rates: { USD: 1, EUR: 0.9, GBP: 0.8, JPY: 150, SEK: 10, CHF: 0.9, CAD: 1.35 }, fetchedAt: Date.now(), source: 'test' } },
  version: '0.2.0',
});
await flush();
await flush();
check('settings page: no script errors', opts.errors.join(' | '), '');
check('settings page: init did not reject', newRejections(), '');
markRejections();
ok('settings page: loads every lib it uses', opts.scripts.length >= 6, `loaded ${opts.scripts.length}`);
check('settings page: currency select filled', el(opts.document, 'currency').innerHTML.includes('USD'), true);
check('settings page: version shown', el(opts.document, 'version').textContent, 'v0.2.0');
check('settings page: rates listed', el(opts.document, 'rate-list').innerHTML.includes('1 EUR ='), true);
check('settings page: profile cards built', el(opts.document, 'profiles').innerHTML.includes('data-role="chest"'), true);
check('settings page: blocked list rendered', el(opts.document, 'hosts').innerHTML.includes('everywhere'), true);

// Every handler the page wires up must survive being called.
const handlerErrors = [];
for (const [id, el] of opts.document.byId) {
  for (const prop of ['onchange', 'onclick', 'onkeydown']) {
    if (typeof el[prop] !== 'function') continue;
    try {
      el[prop]({ target: el, preventDefault() {}, key: 'a' });
    } catch (err) {
      handlerErrors.push(`${id}.${prop}: ${err.message}`);
    }
  }
}
check('settings page: handlers do not throw', handlerErrors.join(' | '), '');

/* ---------- popup ---------- */

const popup = runPage({
  htmlFile: 'src/popup.html',
  scriptFile: 'src/popup.js',
  stored: { length: 'in', currency: 'USD' },
  local: { rates: { rates: { USD: 1 }, fetchedAt: Date.now() } },
});
await flush();
await flush();
check('popup: no script errors', popup.errors.join(' | '), '');
check('popup: init did not reject', newRejections(), '');
markRejections();
check('popup: currency select filled', el(popup.document, 'currency').innerHTML.includes('EUR'), true);

/* ---------- content script and worker parse in their own contexts -------- */

for (const file of ['src/lib/currencies.js', 'src/lib/detect.js', 'src/lib/convert.js', 'src/lib/sizechart.js', 'src/lib/fit.js']) {
  let err = '';
  try {
    const ctx = vm.createContext({ console, Intl, Math, Date, JSON, Number, String, Object, Array, Set, Map, RegExp });
    ctx.globalThis = ctx;
    ctx.self = ctx;
    vm.runInContext(read(file), ctx, { filename: file });
  } catch (e) {
    err = e.message;
  }
  check(`${file} runs standalone`, err, '');
}

/* ---------- the manifest and the files it names must agree -------------- */

const manifest = JSON.parse(read('manifest.json'));
const declared = [
  ...manifest.content_scripts[0].js,
  ...manifest.content_scripts[0].css,
  manifest.background.service_worker,
  manifest.options_page,
  manifest.action.default_popup,
  ...Object.values(manifest.icons),
];
for (const file of declared) {
  ok(`manifest file exists: ${file}`, fs.existsSync(path.join(__dirname, '..', file)));
}
const contentJs = manifest.content_scripts[0].js;
ok(
  'content scripts load libs before content.js',
  contentJs.indexOf('src/content.js') === contentJs.length - 1,
  contentJs.join(', ')
);
for (const lib of ['currencies', 'detect', 'convert', 'sizechart', 'fit']) {
  ok(`content scripts include ${lib}`, contentJs.some((f) => f.includes(lib)));
}

console.log(`${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log('\n' + fails.map((f) => '  ✗ ' + f).join('\n'));
  process.exit(1);
}
}

main().catch((err) => {
  console.error('\nThe suite itself crashed before reporting:\n', err);
  process.exit(1);
});

process.on('exit', (code) => {
  if (code === 0 && !pass) {
    console.error('The suite exited without running a single check.');
    process.exitCode = 1;
  }
});

'use strict';

// getText (src/main/fetchText.ts) follows redirects for callers that fetch URLs
// scraped from third-party pages (skills.ts). A loop there must fail, not spin
// forever, and a relative Location must resolve against the URL that sent it.
// https.request is stubbed, so nothing here touches the network.

const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const loadTs = require('./load-ts.cjs');

const { getText, MAX_REDIRECTS } = loadTs('src/main/fetchText.ts');

/** Replace https.request with `route(url) → { status, location?, body? }` for one test. */
function stubHttps(t, route) {
  const seen = [];
  const real = https.request;
  https.request = (url, _opts, onResponse) => {
    seen.push(String(url));
    if (!/^https:/.test(String(url))) throw new TypeError('Protocol not supported');
    const req = new EventEmitter();
    req.setTimeout = () => req;
    req.destroy = () => {};
    req.end = () => setImmediate(() => {
      const out = route(String(url));
      const res = new PassThrough();
      res.statusCode = out.status;
      res.headers = out.location ? { location: out.location } : {};
      onResponse(res);
      res.end(out.body ?? '');
    });
    return req;
  };
  t.after(() => { https.request = real; });
  return seen;
}

test('a redirect loop rejects after MAX_REDIRECTS hops', async (t) => {
  const seen = stubHttps(t, (url) => ({ status: 302, location: url.endsWith('/a') ? 'https://x.test/b' : 'https://x.test/a' }));
  await assert.rejects(getText('https://x.test/a'), /too many redirects/);
  assert.equal(seen.length, MAX_REDIRECTS + 1);
});

test('a relative Location resolves against the current URL', async (t) => {
  const seen = stubHttps(t, (url) => url === 'https://x.test/dir/start'
    ? { status: 301, location: '../moved/file.md' }
    : { status: 200, body: 'hello' });
  assert.equal(await getText('https://x.test/dir/start'), 'hello');
  assert.deepEqual(seen, ['https://x.test/dir/start', 'https://x.test/moved/file.md']);
});

test('a redirect to http: still fails (https only)', async (t) => {
  stubHttps(t, () => ({ status: 302, location: 'http://x.test/plain' }));
  await assert.rejects(getText('https://x.test/secure'));
});

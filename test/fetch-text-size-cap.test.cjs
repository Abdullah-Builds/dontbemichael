'use strict';

// getText (src/main/fetchText.ts) reads bodies from URLs some callers scrape off
// third-party pages (skills.ts). A huge or endless body must stop at the cap
// instead of filling memory; multi-byte text under the cap must arrive whole.
// https.request is stubbed, so nothing here touches the network.

const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const loadTs = require('./load-ts.cjs');

const { getText } = loadTs('src/main/fetchText.ts');

/** Replace https.request for one test; `write(res)` streams the 200 response. */
function stubHttps(t, write) {
  const state = { destroyed: false };
  const real = https.request;
  https.request = (_url, _opts, onResponse) => {
    const req = new EventEmitter();
    req.setTimeout = () => req;
    req.destroy = () => { state.destroyed = true; };
    req.end = () => setImmediate(() => {
      const res = new PassThrough();
      res.statusCode = 200;
      res.headers = {};
      onResponse(res);
      write(res, state);
    });
    return req;
  };
  t.after(() => { https.request = real; });
  return state;
}

test('a body over maxBytes rejects and drops the connection', async (t) => {
  const state = stubHttps(t, (res, s) => {
    // Endless until the reader gives up.
    const pump = () => { if (!s.destroyed) { res.write(Buffer.alloc(1024, 97)); setImmediate(pump); } };
    pump();
  });
  await assert.rejects(getText('https://x.test/big', { maxBytes: 64 * 1024 }), /response too large/);
  assert.equal(state.destroyed, true);
});

test('a body under the cap arrives whole, multi-byte characters included', async (t) => {
  // "é" split across two chunks: decoding each chunk alone would corrupt it.
  const e = Buffer.from('é');
  stubHttps(t, (res) => { res.write(Buffer.concat([Buffer.from('caf'), e.subarray(0, 1)])); res.end(e.subarray(1)); });
  assert.equal(await getText('https://x.test/small'), 'café');
});

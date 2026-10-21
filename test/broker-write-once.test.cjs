'use strict';

/**
 * A connected app write goes out once (issue #54). The same rule as a sent
 * email: record it before the other service sees it, replay the answer, and
 * refuse a repeat that may already have created an invoice or booking.
 *
 * Value: protects=one agent retry, or a restart after a dropped answer, cannot create a second invoice, booking or contact; fails_when=a repeat is forwarded, a pending write is sent again, a QuickBooks requestid changes between tries, a worker picks the idempotency key, the secret is written into the journal, or a card is opened for the refusal; why_new=mail already had this and broker writes did not; seam=fetchImpl stands in for the other service, and a second broker on the same file stands in for a restart.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const loadTs = require('./load-ts.cjs');

const { IntegrationBroker } = loadTs('src/main/integrationBroker.ts');
const {
  BrokerWriteOnce,
  WRITE_MEMORY_MS,
  WRITE_PENDING_MS,
  WRITE_UNCERTAIN,
  classifyUpstreamFailure,
  withQuickBooksRequestId,
  writeOnceIdentity
} = loadTs('src/main/brokerWriteOnce.ts');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
const DASH = /[\u002D\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/;

function journalFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-write-once-'));
  const file = path.join(dir, 'with space', 'broker-write-journal.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return { dir, file };
}

function record(id, baseUrl, extra = {}) {
  return {
    id,
    label: 'Books',
    kind: 'custom-rest',
    baseUrl,
    authType: 'none',
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...extra
  };
}

function request(base, token, method, route, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const url = new URL(route, base);
    const payload = body === undefined ? '' : body;
    const headers = {
      'x-md-broker-token': token,
      'content-length': Buffer.byteLength(payload),
      ...(extraHeaders ?? {})
    };
    const req = http.request(url, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

function jsonResponse(text, status = 201) {
  return new Response(text, { status, headers: { 'content-type': 'application/json' } });
}

function refused() {
  const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9'), { syscall: 'connect', code: 'ECONNREFUSED' });
  const err = new TypeError('fetch failed');
  err.cause = cause;
  return err;
}

async function startBroker(t, opts) {
  const broker = new IntegrationBroker({
    getRecord: opts.getRecord,
    getSecret: opts.getSecret ?? (() => undefined),
    journalPath: opts.journalPath,
    fetchImpl: opts.fetchImpl,
    now: opts.now,
    replayBodyMax: opts.replayBodyMax
  });
  const started = await broker.start();
  assert.equal(started.ok, true);
  t.after(() => broker.stop());
  t.after(() => { if (opts.dir) fs.rmSync(opts.dir, { recursive: true, force: true }); });
  return broker;
}

test('the same write is forwarded once and replayed, and the secret stays out of the journal', async (t) => {
  const { dir, file } = journalFile();
  const seen = [];
  const broker = await startBroker(t, {
    dir,
    journalPath: file,
    getSecret: () => 'super-secret-token',
    getRecord: () => record('books', 'https://api.example.com/', { authType: 'bearer', secretRef: 'int:books' }),
    fetchImpl: async (url, init) => {
      seen.push({ url: String(url), headers: init.headers });
      return jsonResponse('{"id":"inv_1"}');
    }
  });
  const token = broker.grant('pty-oscar', ['books'], 'oscar');
  const first = await request(broker.url(), token, 'POST', '/i/books/invoice', '{"customer":"Acme"}', { 'idempotency-key': 'from-the-agent' });
  const second = await request(broker.url(), token, 'POST', '/i/books/invoice', '{"customer":"Acme"}');
  assert.equal(first.status, 201);
  assert.equal(first.text, '{"id":"inv_1"}');
  assert.equal(second.status, 201);
  assert.equal(second.text, first.text);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].headers.authorization, 'Bearer super-secret-token');
  assert.match(seen[0].headers['idempotency-key'], /^[a-f0-9]{32}$/);
  assert.notEqual(seen[0].headers['idempotency-key'], 'from-the-agent');
  assert.equal(seen[0].url.includes('requestid='), false);
  const disk = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(disk, /super-secret-token/);
  const row = Object.values(JSON.parse(disk))[0];
  assert.equal(Buffer.from(row.body, 'base64').toString('utf8'), '{"id":"inv_1"}');
});

test('two callers at once share one upstream write', async (t) => {
  const { dir, file } = journalFile();
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const broker = await startBroker(t, {
    dir,
    journalPath: file,
    getRecord: () => record('books', 'https://api.example.com/'),
    fetchImpl: async () => {
      calls++;
      await gate;
      return jsonResponse('{"id":"inv_2"}');
    }
  });
  const token = broker.grant('pty-oscar', ['books'], 'oscar');
  const both = Promise.all([
    request(broker.url(), token, 'POST', '/i/books/invoice', '{"n":1}'),
    request(broker.url(), token, 'POST', '/i/books/invoice', '{"n":1}')
  ]);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(calls, 1);
  release();
  const [a, b] = await both;
  assert.equal(calls, 1);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(a.text, '{"id":"inv_2"}');
  assert.equal(b.text, a.text);
});

test('a write the app stopped in the middle of is refused after a restart, and a connection that never opened can be retried', async (t) => {
  const { dir, file } = journalFile();
  let mode = 'abort';
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (mode === 'abort') {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    }
    if (mode === 'refused') throw refused();
    return jsonResponse('{"id":"inv_3"}');
  };
  const broker = await startBroker(t, {
    dir,
    journalPath: file,
    getRecord: () => record('books', 'https://api.example.com/'),
    fetchImpl
  });
  const token = broker.grant('pty-oscar', ['books'], 'oscar');
  const stopped = await request(broker.url(), token, 'POST', '/i/books/invoice', '{"n":1}');
  assert.equal(stopped.status, 409);
  assert.match(stopped.text, /Tell Michael/);
  assert.equal(stopped.text.includes(WRITE_UNCERTAIN), true);
  assert.doesNotMatch(stopped.text, DASH);
  broker.stop();

  const restarted = await startBroker(t, {
    journalPath: file,
    getRecord: () => record('books', 'https://api.example.com/'),
    fetchImpl: async () => {
      calls++;
      return jsonResponse('{"id":"inv_3"}');
    }
  });
  const again = await request(restarted.url(), restarted.grant('pty-oscar', ['books'], 'oscar'), 'POST', '/i/books/invoice', '{"n":1}');
  assert.equal(again.status, 409, 'a restart must not send the pending write');
  assert.equal(calls, 1);

  mode = 'refused';
  const broker3 = await startBroker(t, {
    journalPath: file,
    getRecord: () => record('books', 'https://api.example.com/'),
    fetchImpl
  });
  // A different body never reached the service, so the retry is a real send.
  const missed = await request(broker3.url(), broker3.grant('pty-oscar', ['books'], 'oscar'), 'POST', '/i/books/invoice', '{"n":2}');
  assert.equal(missed.status, 502);
  assert.match(missed.text, /Not sent/);
  mode = 'ok';
  const retried = await request(broker3.url(), broker3.grant('pty-oscar', ['books'], 'oscar'), 'POST', '/i/books/invoice', '{"n":2}');
  assert.equal(retried.status, 201);
  assert.equal(retried.text, '{"id":"inv_3"}');
});

test('QuickBooks gets a stable requestid, reads are not recorded, a damaged journal is set aside, and an unsavable one sends nothing', async (t) => {
  const { dir, file } = journalFile();
  const seen = [];
  const broker = await startBroker(t, {
    dir,
    journalPath: file,
    getRecord: (id) => record(id, id === 'qbo'
      ? 'https://quickbooks.api.intuit.com/v3/company/99/'
      : 'https://api.example.com/'),
    fetchImpl: async (url, init) => {
      seen.push({ url: String(url), method: init.method, key: init.headers['idempotency-key'] });
      return jsonResponse('{"ok":true}', init.method === 'GET' ? 200 : 201);
    }
  });
  const token = broker.grant('pty-oscar', ['books', 'qbo'], 'oscar');
  await request(broker.url(), token, 'POST', '/i/qbo/invoice', '{"n":1}');
  await request(broker.url(), token, 'POST', '/i/qbo/invoice', '{"n":1}');
  assert.equal(seen.length, 1);
  const requestId = seen[0].key;
  assert.match(seen[0].url, new RegExp(`requestid=${requestId}`));
  await request(broker.url(), token, 'GET', '/i/books/invoice');
  await request(broker.url(), token, 'GET', '/i/books/invoice');
  assert.equal(seen.length, 3, 'a read is not a write');
  assert.equal(seen[1].key, undefined);
  assert.equal(seen[2].key, undefined);

  const damaged = path.join(dir, 'with space', 'damaged.json');
  fs.writeFileSync(damaged, '{', 'utf8');
  const blocked = await startBroker(t, {
    journalPath: damaged,
    getRecord: () => record('books', 'https://api.example.com/'),
    fetchImpl: async () => { seen.push({ damaged: true }); return jsonResponse('{"no":true}'); }
  });
  const token2 = blocked.grant('pty-oscar', ['books'], 'oscar');
  assert.equal((await request(blocked.url(), token2, 'POST', '/i/books/invoice', '{"n":9}')).status, 201);
  assert.equal((await request(blocked.url(), token2, 'POST', '/i/books/bill', '{"n":10}')).status, 201);
  assert.equal(seen.filter((s) => s.damaged).length, 2, 'writes go through after a damaged journal');
  const aside = fs.readdirSync(path.dirname(damaged)).filter((n) => /^damaged\.damaged-\d+\.json$/.test(n));
  assert.equal(aside.length, 1, 'the damaged file is kept to look at');
  assert.equal(fs.readFileSync(path.join(path.dirname(damaged), aside[0]), 'utf8'), '{');
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(damaged, 'utf8'))).length, 2, 'a fresh journal records the new writes');

  const unsaved = await startBroker(t, {
    journalPath: path.join(dir, 'missing', 'journal.json'),
    getRecord: () => record('books', 'https://api.example.com/'),
    fetchImpl: async () => { seen.push({ unsaved: true }); return jsonResponse('{"no":true}'); }
  });
  const notRecorded = await request(unsaved.url(), unsaved.grant('pty-oscar', ['books'], 'oscar'), 'POST', '/i/books/invoice', '{"n":8}');
  assert.equal(notRecorded.status, 503);
  assert.match(notRecorded.text, /could not record/);
  assert.equal(seen.some((s) => s.unsaved), false);
});

test('a different body, a different agent, and an expired answer are sent again; an answer too large to keep is not', async (t) => {
  const { dir, file } = journalFile();
  let now = 5_000_000;
  let calls = 0;
  const broker = await startBroker(t, {
    dir,
    journalPath: file,
    now: () => now,
    replayBodyMax: 4,
    getRecord: () => record('books', 'https://api.example.com/'),
    fetchImpl: async () => {
      calls++;
      return jsonResponse('{"id":"wide"}');
    }
  });
  const oscar = broker.grant('pty-oscar', ['books'], 'oscar');
  const pam = broker.grant('pty-pam', ['books'], 'pam');
  const first = await request(broker.url(), oscar, 'POST', '/i/books/invoice', '{"n":1}');
  assert.equal(first.status, 201);
  assert.equal(first.text, '{"id":"wide"}');
  const replay = await request(broker.url(), oscar, 'POST', '/i/books/invoice', '{"n":1}');
  assert.equal(calls, 1);
  assert.match(replay.text, /too large to keep/);
  assert.doesNotMatch(replay.text, DASH);
  await request(broker.url(), oscar, 'POST', '/i/books/invoice', '{"n":2}');
  await request(broker.url(), pam, 'POST', '/i/books/invoice', '{"n":1}');
  assert.equal(calls, 3);

  now += WRITE_MEMORY_MS + 1;
  // The kept row was truncated, so expiry is what lets the same body go again.
  await request(broker.url(), oscar, 'POST', '/i/books/invoice', '{"n":1}');
  assert.equal(calls, 4);
});

test('identity, QuickBooks requestid, and failure class stay stable', () => {
  const body = Buffer.from('{"n":1}');
  const a = writeOnceIdentity({ agentId: 'oscar', integrationId: 'books', method: 'post', pathAndQuery: 'invoice', body });
  const b = writeOnceIdentity({ agentId: 'oscar', integrationId: 'books', method: 'POST', pathAndQuery: 'invoice', body });
  assert.equal(a.storageKey, b.storageKey);
  assert.equal(a.idempotencyKey, a.storageKey.slice(0, 32));
  assert.notEqual(a.storageKey, writeOnceIdentity({ agentId: 'pam', integrationId: 'books', method: 'POST', pathAndQuery: 'invoice', body }).storageKey);
  const qb = new URL('https://quickbooks.api.intuit.com/v3/company/99/invoice');
  const withId = withQuickBooksRequestId(qb, a.idempotencyKey);
  assert.equal(withId.searchParams.get('requestid'), a.idempotencyKey);
  assert.equal(withQuickBooksRequestId(withId, 'other').searchParams.get('requestid'), a.idempotencyKey);
  assert.equal(withQuickBooksRequestId(new URL('https://api.example.com/invoice'), a.idempotencyKey).search, '');
  const cause = Object.assign(new Error('connect ECONNREFUSED'), { syscall: 'connect', code: 'ECONNREFUSED' });
  const refusedErr = new TypeError('fetch failed');
  refusedErr.cause = cause;
  assert.equal(classifyUpstreamFailure(refusedErr), 'never');
  const aborted = new Error('aborted');
  aborted.name = 'AbortError';
  assert.equal(classifyUpstreamFailure(aborted), 'uncertain');
  assert.equal(classifyUpstreamFailure(new Error('socket hang up')), 'uncertain');
});

test('a pending row and a finished answer age out on their own clocks, and a damaged file is set aside', () => {
  const { dir, file } = journalFile();
  try {
    let now = 1_000;
    const journal = new BrokerWriteOnce(file, () => now);
    const id = writeOnceIdentity({ agentId: 'oscar', integrationId: 'books', method: 'POST', pathAndQuery: 'invoice', body: Buffer.from('x') });
    assert.equal(journal.begin(id.storageKey, id.idempotencyKey), true);
    const reloaded = new BrokerWriteOnce(file, () => now);
    assert.equal(reloaded.lookup(id.storageKey).kind, 'uncertain');
    now += WRITE_PENDING_MS + 1;
    assert.equal(new BrokerWriteOnce(file, () => now).lookup(id.storageKey).kind, 'fresh');

    now = 5_000;
    const done = new BrokerWriteOnce(file, () => now);
    assert.equal(done.begin(id.storageKey, id.idempotencyKey), true);
    done.settle(id.storageKey, 201, 'application/json', Buffer.from('{"id":"1"}'), false);
    const replay = new BrokerWriteOnce(file, () => now).lookup(id.storageKey);
    assert.equal(replay.kind, 'replay');
    assert.equal(replay.body.toString('utf8'), '{"id":"1"}');
    now += WRITE_MEMORY_MS + 1;
    assert.equal(new BrokerWriteOnce(file, () => now).lookup(id.storageKey).kind, 'fresh');

    const damaged = path.join(dir, 'with space', 'bad.json');
    fs.writeFileSync(damaged, '{', 'utf8');
    const fresh = new BrokerWriteOnce(damaged, () => now);
    assert.equal(fresh.lookup('anything').kind, 'fresh');
    assert.equal(fresh.begin('anything', 'key'), true);
    assert.equal(fs.readFileSync(path.join(dir, 'with space', `bad.damaged-${now}.json`), 'utf8'), '{');
    // A file of the wrong shape is set aside too.
    fs.writeFileSync(damaged, '{"k":{"at":"soon"}}', 'utf8');
    now += 1;
    assert.equal(new BrokerWriteOnce(damaged, () => now).lookup('k').kind, 'fresh');
    assert.ok(fs.existsSync(path.join(dir, 'with space', `bad.damaged-${now}.json`)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the app keeps the journal beside the mail journal and does not open a card', () => {
  const index = read('src/main/index.ts');
  assert.match(index, /journalPath: join\(app\.getPath\('userData'\), 'broker-write-journal\.json'\)/);
  const src = read('src/main/integrationBroker.ts') + read('src/main/brokerWriteOnce.ts');
  assert.doesNotMatch(src, /addTask|patchTask|humanQA/);
  for (const message of [WRITE_UNCERTAIN]) {
    assert.doesNotMatch(message, DASH);
  }
});

test('only a write that worked is replayed: a retry after a rate limit or a server error reaches the service again', async (t) => {
  // Value: protects=a 429 or 5xx does not block that write for ten minutes; fails_when=a failed answer is kept and replayed, or the retry carries a new key; why_new=owner review on #212; seam=fetchImpl
  const { dir, file } = journalFile();
  const answers = [
    () => new Response('{"error":"slow down"}', { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '1' } }),
    () => jsonResponse('{"id":"inv-1"}', 201),
    () => jsonResponse('{"error":"try later"}', 500),
    () => jsonResponse('{"id":"bill-1"}', 201)
  ];
  const keys = [];
  const broker = await startBroker(t, {
    dir,
    journalPath: file,
    getRecord: () => record('books', 'https://api.example.com/'),
    fetchImpl: async (_url, init) => { keys.push(init.headers['idempotency-key']); return answers[keys.length - 1](); }
  });
  const token = broker.grant('pty-oscar', ['books'], 'oscar');
  assert.equal((await request(broker.url(), token, 'POST', '/i/books/invoice', '{"n":1}')).status, 429);
  // The broker holds the retry until the app's second is up, then sends it.
  const second = await request(broker.url(), token, 'POST', '/i/books/invoice', '{"n":1}');
  assert.equal(second.status, 201);
  assert.equal(keys.length, 2, 'the retry reached the service');
  assert.equal(keys[0], keys[1], 'with the same key, so the service can still dedupe');
  assert.equal((await request(broker.url(), token, 'POST', '/i/books/bill', '{"n":2}')).status, 500);
  assert.equal((await request(broker.url(), token, 'POST', '/i/books/bill', '{"n":2}')).status, 201);
  assert.equal(keys.length, 4);
  // A write that worked is still answered from the journal.
  assert.equal((await request(broker.url(), token, 'POST', '/i/books/bill', '{"n":2}')).status, 201);
  assert.equal(keys.length, 4);
});

test('a write answer cut partway drops the connection and is not sent again', async (t) => {
  // Value: protects=a cut answer never reads as whole, and the write it answered is not repeated; fails_when=the write path ends the reply cleanly after a stream error (main's #433 rule), or the retry is forwarded; why_new=main added cut handling after this PR; seam=fetchImpl
  const { dir, file } = journalFile();
  let calls = 0;
  const broker = await startBroker(t, {
    dir,
    journalPath: file,
    getRecord: () => record('books', 'https://api.example.com/'),
    fetchImpl: async () => {
      calls += 1;
      const body = new ReadableStream({
        start(c) { c.enqueue(new TextEncoder().encode('{"id":"inv-')); },
        pull(c) { c.error(new Error('socket hang up')); }
      });
      return new Response(body, { status: 201, headers: { 'content-type': 'application/json' } });
    }
  });
  const token = broker.grant('pty-oscar', ['books'], 'oscar');
  await assert.rejects(request(broker.url(), token, 'POST', '/i/books/invoice', '{"n":1}'));
  const retry = await request(broker.url(), token, 'POST', '/i/books/invoice', '{"n":1}');
  assert.equal(retry.status, 409);
  assert.match(retry.text, /already went through/);
  assert.equal(calls, 1);
});

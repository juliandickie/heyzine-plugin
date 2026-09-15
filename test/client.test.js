import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HeyzineError, classify, HeyzineClient, retriesTransient, DEFAULT_TIMEOUT_MS, CONVERT_TIMEOUT_MS } from '../lib/client.mjs';

function fakeFetch(script) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const next = typeof script === 'function' ? script(calls.length, String(url), init) : script[calls.length - 1];
    if (next instanceof Error) throw next;
    const { status = 200, body = '', headers = {} } = next;
    return { status, ok: status < 400, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
  return { fetch, calls };
}

const noSleep = async () => {};

test('classify maps the observed Heyzine error bodies', () => {
  assert.throws(() => classify({ status: 200, body: { success: false, code: 403, msg: 'Invalid user or api key' }, endpoint: 'flipbook-list' }), (e) => e instanceof HeyzineError && e.code === 'auth');
  assert.throws(() => classify({ status: 200, body: { success: false, code: 403, msg: 'Private API endpoint. Contact support@heyzine.com for more details.' }, endpoint: 'flipbook-replace' }), (e) => e.code === 'plan' && /support@heyzine.com/.test(e.message));
  assert.throws(() => classify({ status: 200, body: { success: false, code: 403, msg: 'Unauthorized' }, endpoint: 'flipbook-details' }), (e) => e.code === 'not_found' && /full id/.test(e.message));
  assert.throws(() => classify({ status: 200, body: { success: false, msg: 'Requires a plan with custom URLs' }, endpoint: 'flipbook-design' }), (e) => e.code === 'plan');
  assert.throws(() => classify({ status: 200, body: { success: false, msg: 'url_path contains invalid characters' }, endpoint: 'flipbook-design' }), (e) => e.code === 'validation');
  assert.throws(() => classify({ status: 404, body: undefined, text: '<html><title>Flipbook load error</title>', endpoint: 'nonsense' }), (e) => e.code === 'not_found');
  assert.throws(() => classify({ status: 401, body: {}, endpoint: 'x' }), (e) => e.code === 'auth');
  assert.throws(() => classify({ status: 503, body: undefined, text: 'busy', endpoint: 'x' }), (e) => e.code === 'transient' && e.retryable === true);
  assert.throws(() => classify({ status: 500, body: { error: 'boom' }, endpoint: 'x' }), (e) => e.code === 'transient');
  assert.deepEqual(classify({ status: 200, body: { success: true, code: 200, msg: 'Flipbook updated' }, endpoint: 'flipbook-design' }), { success: true, code: 200, msg: 'Flipbook updated' });
  assert.deepEqual(classify({ status: 200, body: [{ id: 'a' }], endpoint: 'flipbook-list' }), [{ id: 'a' }]);
});

test('request sends the Bearer header, JSON bodies, and query strings', async () => {
  const { fetch, calls } = fakeFetch([{ body: [{ id: 'x' }] }, { body: { success: true } }]);
  const c = new HeyzineClient({ key: 'K', fetch, sleep: noSleep });
  await c.listFlipbooks({ limit: 5, offset: 0 });
  assert.equal(calls[0].url, 'https://heyzine.com/api1/flipbook-list?limit=5&offset=0');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer K');
  assert.equal(calls[0].init.body, undefined);
  await c.updateDesign('id.pdf', { title: 'T', download: false });
  assert.equal(calls[1].url, 'https://heyzine.com/api1/flipbook-design');
  assert.equal(calls[1].init.method, 'PATCH');
  assert.equal(calls[1].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[1].init.body), { id: 'id.pdf', title: 'T', download: false });
});

test('every endpoint method hits the documented path and verb', async () => {
  const seen = [];
  const { fetch } = fakeFetch((n, url, init) => { seen.push(`${init.method} ${url.replace('https://heyzine.com/api1/', '')}`); return { body: { success: true } }; });
  const c = new HeyzineClient({ key: 'K', fetch, sleep: noSleep });
  await c.flipbookDetails('a.pdf');
  await c.convertAsync({ pdf: 'u', client_id: 'c' });
  await c.convertSync({ pdf: 'u', client_id: 'c' });
  await c.setSocial('a.pdf', { title: 't' });
  await c.replacePdf('a.pdf', 'https://x/y.pdf');
  await c.deleteFlipbook('a.pdf');
  await c.listBookshelves();
  await c.bookshelfFlipbooks('s');
  await c.addToBookshelf('s', 'a.pdf', 2);
  await c.removeFromBookshelf('s', 'a.pdf');
  await c.setBookshelfSocial('s', { title: 't' });
  await c.accessSetup({ id: 'a.pdf', mode: 'everyone', password: 'p' });
  await c.accessAdd({ id: 'a.pdf', access_type: 'user_pass', user: 'u', password: 'p' });
  await c.accessRemove({ id: 'a.pdf', user: 'u' });
  await c.oembed('https://heyzine.com/flip-book/a.html', { maxwidth: 800 });
  assert.deepEqual(seen, [
    'GET flipbook-details?id=a.pdf', 'POST async', 'POST rest', 'POST flipbook-social', 'POST flipbook-replace', 'POST flipbook-delete',
    'GET bookshelf-list', 'GET bookshelf-flipbooks?id=s', 'POST bookshelf-add', 'POST bookshelf-remove', 'POST bookshelf-social',
    'POST access-setup', 'POST access-add', 'POST access-remove',
    'GET oembed?url=https%3A%2F%2Fheyzine.com%2Fflip-book%2Fa.html&format=json&maxwidth=800',
  ]);
});

test('access calls send id and also name for older servers, and bookshelf add sends position only when given', async () => {
  const bodies = [];
  const { fetch } = fakeFetch((n, url, init) => { bodies.push(JSON.parse(init.body)); return { body: { success: true } }; });
  const c = new HeyzineClient({ key: 'K', fetch, sleep: noSleep });
  await c.accessSetup({ id: 'a.pdf', type: 'bookshelf', mode: 'users' });
  await c.addToBookshelf('s', 'a.pdf');
  await c.addToBookshelf('s', 'a.pdf', 0);
  assert.deepEqual(bodies[0], { id: 'a.pdf', name: 'a.pdf', type: 'bookshelf', mode: 'users' });
  assert.deepEqual(bodies[1], { id: 's', flipbook_id: 'a.pdf' });
  assert.deepEqual(bodies[2], { id: 's', flipbook_id: 'a.pdf', position: 0 });
});

test('transient failures retry three times with the backoff schedule, then throw', async () => {
  const slept = [];
  const { fetch, calls } = fakeFetch([{ status: 503, body: 'busy' }, new Error('ECONNRESET'), { status: 502, body: 'bad' }, { body: [{ id: 'ok' }] }]);
  const c = new HeyzineClient({ key: 'K', fetch, sleep: async (ms) => { slept.push(ms); } });
  assert.deepEqual(await c.listFlipbooks(), [{ id: 'ok' }]);
  assert.equal(calls.length, 4);
  assert.deepEqual(slept, [1000, 3000, 9000]);
  const { fetch: always } = fakeFetch(() => ({ status: 500, body: 'x' }));
  const d = new HeyzineClient({ key: 'K', fetch: always, sleep: noSleep });
  await assert.rejects(d.listFlipbooks(), (e) => e.code === 'transient');
  const { fetch: authFail, calls: authCalls } = fakeFetch(() => ({ body: { success: false, code: 403, msg: 'Invalid user or api key' } }));
  const e = new HeyzineClient({ key: 'K', fetch: authFail, sleep: noSleep });
  await assert.rejects(e.listFlipbooks(), (err) => err.code === 'auth');
  assert.equal(authCalls.length, 1);
});

test('mcpCall posts a tools/call envelope and unwraps text or JSON results', async () => {
  const { fetch, calls } = fakeFetch([
    { body: { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '{"success":true,"data":[{"flipbook":"<short>.html","page":6,"text":"zirconia"}]}' }] } } },
    { body: { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'Plain page text' }] } } },
    { body: { jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ type: 'text', text: 'Bookshelf tools require a plan that includes bookshelves' }] } } },
    { body: { jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Unknown tool' } } },
    { status: 401, body: { error: 'unauthorized' } },
  ]);
  const c = new HeyzineClient({ key: 'K', fetch, sleep: noSleep });
  const hits = await c.searchText('zirconia');
  assert.deepEqual(hits, [{ flipbook: '<short>.html', page: 6, text: 'zirconia' }]);
  assert.equal(calls[0].url, 'https://heyzine.com/mcp');
  assert.equal(calls[0].init.headers['MCP-Protocol-Version'], '2025-06-18');
  assert.equal(calls[0].init.headers.Accept, 'application/json, text/event-stream');
  assert.deepEqual(JSON.parse(calls[0].init.body).params, { name: 'heyzine_search_text', arguments: { q: 'zirconia' } });
  assert.equal(await c.pageText('<short>', 1), 'Plain page text');
  assert.deepEqual(JSON.parse(calls[1].init.body).params.arguments, { n: '<short>', p: 1 });
  await assert.rejects(c.mcpCall('heyzine_list_bookshelves', {}), (e) => e.code === 'plan');
  await assert.rejects(c.mcpCall('nope', {}), (e) => e.code === 'validation' && /Unknown tool/.test(e.message));
  await assert.rejects(c.mcpCall('heyzine_list_flipbooks', {}), (e) => e.code === 'auth');
});

test('classify covers the HTTP status branches', () => {
  assert.throws(() => classify({ status: 403, body: { msg: 'Requires a plan with custom URLs' }, endpoint: 'flipbook-design' }), (e) => e instanceof HeyzineError && e.code === 'plan');
  assert.throws(() => classify({ status: 403, body: { msg: 'Forbidden' }, endpoint: 'flipbook-design' }), (e) => e.code === 'auth');
  assert.throws(() => classify({ status: 400, body: { msg: 'bad request' }, endpoint: 'flipbook-design' }), (e) => e.code === 'validation');
  assert.throws(() => classify({ status: 418, body: {}, endpoint: 'x' }), (e) => e.code === 'unknown');
});

test('a missing key is a config error and the key never enumerates or serialises', () => {
  assert.throws(() => new HeyzineClient({}), (e) => e instanceof HeyzineError && e.code === 'config');
  const { fetch } = fakeFetch(() => ({ body: { success: true } }));
  const c = new HeyzineClient({ key: 'sk-secret-value', fetch, sleep: noSleep });
  assert.ok(!Object.keys(c).includes('key'));
  assert.ok(!JSON.stringify(c).includes('sk-secret-value'));
  assert.equal(c.key, 'sk-secret-value');
});

test('a per-call backoffMs of [] stops the retry loop after one fetch', async () => {
  const slept = [];
  const { fetch, calls } = fakeFetch(() => ({ status: 503, body: 'busy' }));
  const c = new HeyzineClient({ key: 'K', fetch, sleep: async (ms) => { slept.push(ms); } });
  await assert.rejects(c.request('GET', 'flipbook-list', { backoffMs: [] }), (e) => e.code === 'transient');
  assert.equal(calls.length, 1);
  assert.deepEqual(slept, []);
});

test('every request carries an abort signal and an abort maps to timeout without a retry', async () => {
  const { fetch, calls } = fakeFetch(() => Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
  const c = new HeyzineClient({ key: 'K', fetch, sleep: noSleep });
  await assert.rejects(
    c.listFlipbooks(),
    (e) => e.code === 'timeout' && /flipbook-list did not answer within 60000 ms/.test(e.message) && e.retryable === false,
  );
  assert.equal(calls.length, 1, 'a timeout is never retried');
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.equal(DEFAULT_TIMEOUT_MS, 60000);
  assert.equal(CONVERT_TIMEOUT_MS, 900000);
});

test('convertSync passes the long blocking timeout down to the fetch signal', async () => {
  const signals = [];
  const hang = async (url, init) => {
    signals.push(init.signal);
    return new Promise((resolve, reject) => { init.signal.addEventListener('abort', () => reject(init.signal.reason)); });
  };
  assert.equal(new HeyzineClient({ key: 'K', fetch: hang }).convertTimeoutMs, 900000);
  const c = new HeyzineClient({ key: 'K', fetch: hang, sleep: noSleep, convertTimeoutMs: 20 });
  await assert.rejects(
    c.convertSync({ pdf: 'u', client_id: 'c' }),
    (e) => e.code === 'timeout' && /rest did not answer within 20 ms/.test(e.message) && e.retryable === false,
  );
  assert.equal(signals.length, 1);
  assert.ok(signals[0] instanceof AbortSignal);
});

test('only GET and the two convert endpoints retry a transient failure', async () => {
  assert.equal(retriesTransient('GET', 'flipbook-list'), true);
  assert.equal(retriesTransient('POST', 'async'), true);
  assert.equal(retriesTransient('POST', 'rest'), true);
  for (const [method, endpoint] of [['POST', 'bookshelf-add'], ['POST', 'flipbook-delete'], ['PATCH', 'flipbook-design'], ['POST', 'access-add']]) {
    assert.equal(retriesTransient(method, endpoint), false, `${method} ${endpoint}`);
  }
  const slept = [];
  const { fetch, calls } = fakeFetch(() => ({ status: 503, body: 'busy' }));
  const c = new HeyzineClient({ key: 'K', fetch, sleep: async (ms) => { slept.push(ms); } });
  await assert.rejects(c.addToBookshelf('s', 'a.pdf', 1), (e) => e.code === 'transient' && e.status === 503);
  assert.equal(calls.length, 1, 'a write is attempted exactly once');
  assert.deepEqual(slept, []);
  const { fetch: convertFetch, calls: convertCalls } = fakeFetch([{ status: 503, body: 'busy' }, { body: { id: 'a.pdf', state: 'started' } }]);
  const d = new HeyzineClient({ key: 'K', fetch: convertFetch, sleep: noSleep });
  assert.equal((await d.convertAsync({ pdf: 'u', client_id: 'c' })).id, 'a.pdf');
  assert.equal(convertCalls.length, 2, 'the convert endpoints still retry');
  const { fetch: forced, calls: forcedCalls } = fakeFetch(() => ({ status: 503, body: 'busy' }));
  const e = new HeyzineClient({ key: 'K', fetch: forced, sleep: noSleep });
  await assert.rejects(e.request('POST', 'bookshelf-add', { body: {}, backoffMs: [1] }), (err) => err.code === 'transient');
  assert.equal(forcedCalls.length, 2, 'a per-call backoffMs still forces retries on');
});

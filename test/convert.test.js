import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONVERT_FIELDS, convertParams, convertAndWait } from '../lib/convert.mjs';

test('convertParams requires pdf and client id and drops empties', () => {
  assert.throws(() => convertParams({ pdf: '', clientId: 'c' }), (e) => e.code === 'validation');
  assert.throws(() => convertParams({ pdf: 'u', clientId: '' }), (e) => e.code === 'config' && /client_id/.test(e.message));
  const p = convertParams({ pdf: 'u', clientId: 'c', title: 'T', download: false, tags: '', logo: undefined, template: null, replace: true, bogus: 1 });
  assert.deepEqual(p, { pdf: 'u', client_id: 'c', title: 'T', download: false, replace: true });
  assert.ok(CONVERT_FIELDS.includes('private_note') && CONVERT_FIELDS.includes('url_domain'));
});

function scriptedClient(states) {
  const calls = [];
  return {
    calls,
    convertAsync: async (params) => {
      calls.push({ ...params });
      const s = states[Math.min(calls.length - 1, states.length - 1)];
      return typeof s === 'string' ? { id: 'abc.pdf', url: 'https://heyzine.com/flip-book/abc.html', state: s } : s;
    },
  };
}

test('convertAndWait polls until processed and strips replace after the first call', async () => {
  const client = scriptedClient(['started', 'started', 'processed']);
  const slept = [];
  let clock = 0;
  const result = await convertAndWait(client, { pdf: 'u', client_id: 'c', replace: true }, { intervalMs: 5000, sleep: async (ms) => { slept.push(ms); clock += ms; }, now: () => clock });
  assert.equal(result.state, 'processed');
  assert.equal(result.polls, 3);
  assert.deepEqual(slept, [5000, 5000]);
  assert.equal(client.calls[0].replace, true);
  assert.equal('replace' in client.calls[1], false);
  assert.equal('replace' in client.calls[2], false);
});

test('a response without state but with an id counts as finished', async () => {
  const client = scriptedClient([{ id: 'abc.pdf', url: 'u', meta: { num_pages: 3 } }]);
  const r = await convertAndWait(client, { pdf: 'u', client_id: 'c' }, { sleep: async () => {} });
  assert.equal(r.polls, 1);
});

test('failed state throws conversion_failed with the URL', async () => {
  const client = scriptedClient(['started', 'failed']);
  await assert.rejects(convertAndWait(client, { pdf: 'https://x/y.pdf', client_id: 'c' }, { sleep: async () => {} }), (e) => e.code === 'conversion_failed' && /https:\/\/x\/y\.pdf/.test(e.message));
});

test('timeout throws with the id and says to poll again', async () => {
  const client = scriptedClient(['started']);
  let clock = 0;
  await assert.rejects(
    convertAndWait(client, { pdf: 'u', client_id: 'c' }, { intervalMs: 1000, timeoutMs: 3000, sleep: async (ms) => { clock += ms; }, now: () => clock }),
    (e) => e.code === 'timeout' && /abc\.pdf/.test(e.message) && /poll again/.test(e.message) && e.retryable === true,
  );
  assert.ok(client.calls.length >= 3 && client.calls.length <= 4);
});

test('the conversion_failed and timeout messages drop the query string of the source URL', async () => {
  const failing = scriptedClient(['failed']);
  await assert.rejects(
    convertAndWait(failing, { pdf: 'https://x/y.pdf?token=abc#page=2', client_id: 'c' }, { sleep: async () => {} }),
    (e) => e.code === 'conversion_failed' && e.message.includes('https://x/y.pdf') && !e.message.includes('token') && !e.message.includes('#page'),
  );
  const slow = scriptedClient(['started']);
  let clock = 0;
  await assert.rejects(
    convertAndWait(slow, { pdf: 'https://x/y.pdf?token=abc', client_id: 'c' }, { intervalMs: 1000, timeoutMs: 2000, sleep: async (ms) => { clock += ms; }, now: () => clock }),
    (e) => e.code === 'timeout' && e.message.includes('https://x/y.pdf') && !e.message.includes('token'),
  );
});

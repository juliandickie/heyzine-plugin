import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowToSpec, runBatch, resultsCsv, RESULT_COLUMNS, coerceBool } from '../lib/batch.mjs';

test('rowToSpec maps csv columns and coerces booleans', () => {
  const spec = rowToSpec({ name: 'Doc', source: '1AbCdEfGhIjKlM', purpose: 'course-material', course: 'PCP', idd_to: 'pcp-doc', template: 't.pdf', download: 'true', tags: 'summer', note: 'n', description: 'd', replace: 'yes', url_path: 'p' });
  assert.equal(spec.name, 'Doc');
  assert.equal(spec.iddTo, 'pcp-doc');
  assert.equal(spec.course, 'PCP');
  assert.deepEqual(spec.design, { download: true });
  assert.equal(spec.replace, true);
  assert.equal(spec.urlPath, 'p');
  assert.deepEqual(rowToSpec({ name: 'X', source: 'u' }).design, {});
});

test('runBatch runs rows with bounded concurrency, skips existing unless replace, and summarises', async () => {
  let active = 0; let peak = 0;
  const publish = async (ctx, spec) => {
    active += 1; peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active -= 1;
    if (spec.name === 'Bad') { const e = new Error('Heyzine reported the conversion failed'); e.code = 'conversion_failed'; throw e; }
    return { id: `${spec.name}.pdf`, short: spec.name.slice(0, 10), url: `https://h/${spec.name}.html`, base: 'b', pages: 1, replaced: Boolean(spec.replace), verify: [] };
  };
  const cache = { items: [{ id: 'old.pdf', title: 'Existing', links: { base: 'https://heyzine.com/flip-book/old.html' }, register: { fields: {} }, facets: {} }] };
  const rows = [
    { name: 'One', source: 'https://x/1.pdf' }, { name: 'Two', source: 'https://x/2.pdf' }, { name: 'Bad', source: 'https://x/3.pdf' },
    { name: 'Existing', source: 'https://x/4.pdf' }, { name: 'Existing', source: 'https://x/4.pdf', replace: 'true' },
  ];
  const seen = [];
  const { results, summary } = await runBatch({}, rows, { concurrency: 2, cache, publish, onRow: (r) => seen.push(r.status) });
  assert.equal(peak, 2);
  assert.deepEqual(results.map((r) => r.status), ['converted', 'converted', 'failed', 'skipped-existing', 'replaced']);
  assert.equal(results[2].error, 'conversion_failed: Heyzine reported the conversion failed');
  assert.equal(results[3].id, 'old.pdf');
  assert.deepEqual(summary, { total: 5, converted: 2, replaced: 1, skipped: 1, failed: 1 });
  assert.equal(seen.length, 5);
});

test('resultsCsv writes every result column', () => {
  const csv = resultsCsv([{ row: 1, name: 'One', status: 'converted', id: 'a.pdf', short: 'a', url: 'u', base: 'b', pages: 2, error: '' }]);
  assert.equal(csv.split('\n')[0], RESULT_COLUMNS.join(','));
  assert.match(csv, /\n1,One,converted,a\.pdf,a,u,b,2,\n/);
});

test('runBatch survives a non-finite concurrency', async () => {
  const publish = async (ctx, spec) => ({ id: `${spec.name}.pdf`, short: 'x', url: 'u', base: 'b', pages: 1 });
  const { summary } = await runBatch({}, [{ name: 'One', source: 'https://x/1.pdf' }], { concurrency: Number('abc'), publish });
  assert.equal(summary.converted, 1);
});

test('a malformed row fails that row only, the rest of the batch completes', async () => {
  const publish = async (ctx, spec) => {
    if (!spec.source) { const e = new Error('Source must be a public URL or a Google Drive file id or link'); e.code = 'validation'; throw e; }
    return { id: `${spec.name}.pdf`, short: 'x', url: 'u', base: 'b', pages: 1 };
  };
  const rows = [{ name: 'Fine', source: 'https://x/1.pdf' }, { name: 'Broken', source: undefined }, null, { name: 'Also fine', source: 'https://x/2.pdf' }];
  const { results, summary } = await runBatch({}, rows, { concurrency: 2, publish });
  assert.deepEqual(results.map((r) => r.status), ['converted', 'failed', 'failed', 'converted']);
  assert.equal(results[1].error, 'validation: Source must be a public URL or a Google Drive file id or link');
  assert.equal(results[2].name, '');
  assert.match(results[2].error, /^error: /);
  assert.deepEqual(summary, { total: 4, converted: 2, replaced: 0, skipped: 0, failed: 2 });
});

test('an unrecognised boolean cell throws instead of reading as false', () => {
  assert.equal(coerceBool('', 'download'), undefined);
  assert.equal(coerceBool('   ', 'download'), undefined);
  assert.equal(coerceBool(undefined, 'download'), undefined);
  assert.equal(coerceBool('Yes', 'download'), true);
  assert.equal(coerceBool('N', 'download'), false);
  assert.throws(
    () => rowToSpec({ name: 'X', source: 'u', download: 'yes please' }),
    (e) => e.code === 'validation' && e.message === 'column download has an unrecognised boolean value "yes please"',
  );
  assert.throws(
    () => rowToSpec({ name: 'X', source: 'u', replace: 'maybe' }),
    (e) => e.code === 'validation' && /column replace has an unrecognised boolean value "maybe"/.test(e.message),
  );
});

test('a row with an unrecognised boolean fails that row only', async () => {
  const publish = async (ctx, spec) => ({ id: `${spec.name}.pdf`, short: 'x', url: 'u', base: 'b', pages: 1 });
  const rows = [
    { name: 'Fine', source: 'https://x/1.pdf' },
    { name: 'Typo', source: 'https://x/2.pdf', download: 'yes please' },
    { name: 'Also fine', source: 'https://x/3.pdf' },
  ];
  const { results, summary } = await runBatch({}, rows, { concurrency: 2, publish });
  assert.deepEqual(results.map((r) => r.status), ['converted', 'failed', 'converted']);
  assert.equal(results[1].error, 'validation: column download has an unrecognised boolean value "yes please"');
  assert.equal(results[1].name, 'Typo');
  assert.deepEqual(summary, { total: 3, converted: 2, replaced: 0, skipped: 0, failed: 1 });
});

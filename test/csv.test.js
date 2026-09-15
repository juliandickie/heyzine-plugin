import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, toCsv } from '../lib/csv.mjs';

test('parseCsv reads headers, quotes, doubled quotes and blank lines', () => {
  const rows = parseCsv('name,source,note\n"Medit i900, Review",1AbC,"He said ""hi"""\n\nplain,https://x/y.pdf,\n');
  assert.deepEqual(rows, [
    { name: 'Medit i900, Review', source: '1AbC', note: 'He said "hi"' },
    { name: 'plain', source: 'https://x/y.pdf', note: '' },
  ]);
  assert.deepEqual(parseCsv(''), []);
});

test('toCsv quotes when needed and keeps column order', () => {
  assert.equal(toCsv([{ a: 'x,y', b: 'q"r', c: undefined }], ['a', 'b', 'c']), 'a,b,c\n"x,y","q""r",\n');
});

test('parseCsv treats a quote inside an unquoted field as literal', () => {
  assert.deepEqual(parseCsv('name\nJohn 12" model\nSecond\n'), [
    { name: 'John 12" model' },
    { name: 'Second' },
  ]);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  inventoryPath, normaliseTitle, overlap, matchTitle, parseNamesFile, refreshInventory, loadInventory, resolveFullId, reconcile,
} from '../lib/inventory.mjs';

const item = (id, title, extra = {}) => ({ id, title, pages: 1, links: { custom: `https://heyzine.com/flip-book/${id.slice(0, 10)}.html`, base: `https://heyzine.com/flip-book/${id.slice(0, 10)}.html` }, tags: '', private: '', ...extra });
const A = item('7777777777aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf', 'Medit i900 Intraoral Scanner Review', { tags: 'purpose:review,link:ios-review-medit-i900', private: 'idd_to = ios-review-medit-i900' });
const B = item('a1b2c3d4e5f60718293a4b5c6d7e8f9012345678.pdf', 'CAD/CAM Chairside Materials Overview');
const C = item('0d0d0d0d0daaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf', 'Chairside Processing of Monolithic Zirconia Restorations - Ceramic Restoration Workflows');
const D = item('1111111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf', 'Medit i900 Classic Review PDF');
const cacheOf = (items) => ({ fetched_at: 'x', count: items.length, items: items.map((i) => ({ ...i, register: { fields: {}, other: [] }, facets: {} })), bookshelves: [{ id: 'a16ec9269b8d436092e69be09a107d1d264e9f18', title: 'Perfect Ceramic Processing PDFs' }], bookshelves_error: null });

test('normaliseTitle strips PDF markers, configured brand suffixes and punctuation', () => {
  assert.equal(normaliseTitle('CAD/CAM Chairside Materials Overview - ACME', { suffixes: ['acme'] }), 'cad cam chairside materials overview');
  assert.equal(normaliseTitle('Medit i900 Classic Review PDF'), 'medit i900 classic review');
  assert.equal(normaliseTitle('Alliedstar AS 260 Review PDF'), 'alliedstar as 260 review');
  assert.equal(normaliseTitle('  Zirconia Guide from Indication to Cementation - ACME ', { suffixes: ['acme'] }), 'zirconia guide from indication to cementation');
  assert.equal(normaliseTitle('Formlabs Form 4B Review – Breaking Free'), 'formlabs form 4b review breaking free');
  assert.equal(normaliseTitle('Scanner Guide - ACME.', { suffixes: ['acme'] }), 'scanner guide');
});

test('overlap and matchTitle tiers', () => {
  assert.equal(overlap('a b c', 'a b c'), 1);
  assert.equal(overlap('a b c d', 'a b c'), 0.75);
  assert.equal(matchTitle('CAD/CAM Chairside Materials Overview', [A, B, C]).tier, 'exact');
  const fuzzy = matchTitle('Medit i900 Intraoral Scanner Review (2025)', [A, B, C, D]);
  assert.equal(fuzzy.tier, 'fuzzy');
  assert.equal(fuzzy.matches[0].item.id, A.id);
  const sub = matchTitle('Chairside Processing of Monolithic Zirconia Restorations', [A, B, C]);
  assert.ok(['fuzzy', 'substring'].includes(sub.tier));
  assert.equal(sub.matches[0].item.id, C.id);
  assert.equal(matchTitle('Totally different', [A, B, C]).tier, 'none');
});

test('parseNamesFile handles a markdown table, a csv and plain lines', () => {
  const md = ['# deck', '', '| # | Course | Anchor name | short slug |', '|---|---|---|---|', '| 1 | X | 3DISC Heron Intraoral Scanner Review | ios-review-3disc-heron |', '| 2 | Y | Medit i600 Intraoral Scanner Review | ios-review-medit-i600 |'].join('\n');
  assert.deepEqual(parseNamesFile(md), ['3DISC Heron Intraoral Scanner Review', 'Medit i600 Intraoral Scanner Review']);
  assert.deepEqual(parseNamesFile('name,slug\n"A, B",x\nC,y\n'), ['A, B', 'C']);
  assert.deepEqual(parseNamesFile('# comment\nOne\n\nTwo\n'), ['One', 'Two']);
});

test('refreshInventory fetches details for every flipbook and tolerates a bookshelf plan error', async () => {
  const client = {
    listFlipbooks: async () => [A, B].map(({ tags, private: p, ...rest }) => rest),
    flipbookDetails: async (id) => (id === A.id ? { ...A, oembed: { html: '<iframe></iframe>' } } : { ...B }),
    listBookshelves: async () => { const e = new Error('Bookshelf tools require a plan that includes bookshelves'); e.code = 'plan'; throw e; },
  };
  let written;
  const progress = [];
  const cache = await refreshInventory(client, { writeFile: async (text) => { written = text; }, now: () => new Date('2026-09-15T00:00:00Z'), onProgress: (i, n) => progress.push([i, n]) });
  assert.equal(cache.fetched_at, '2026-09-15T00:00:00.000Z');
  assert.equal(cache.count, 2);
  assert.equal(cache.items[0].tags, 'purpose:review,link:ios-review-medit-i900');
  assert.deepEqual(cache.items[0].register.fields, { idd_to: 'ios-review-medit-i900' });
  assert.deepEqual(cache.items[0].facets.link, ['ios-review-medit-i900']);
  assert.deepEqual(cache.bookshelves, []);
  assert.match(cache.bookshelves_error, /plan/);
  assert.deepEqual(progress, [[1, 2], [2, 2]]);
  assert.equal(JSON.parse(written).count, 2);
});

test('loadInventory returns null when the cache is missing and resolveFullId finds by short id, url or slug', async () => {
  assert.equal(await loadInventory({ dir: '/d', readFile: async () => { const e = new Error('x'); e.code = 'ENOENT'; throw e; } }), null);
  assert.equal(inventoryPath('/d'), '/d/inventory.json');
  const cache = cacheOf([A, B]);
  assert.deepEqual(resolveFullId('7777777777', cache), { kind: 'flipbook', full: A.id });
  assert.deepEqual(resolveFullId('https://docs.aflip.in/a1b2c3d4e5.html', cache), { kind: 'flipbook', full: B.id });
  assert.deepEqual(resolveFullId(A.id, cache), { kind: 'flipbook', full: A.id });
  assert.deepEqual(resolveFullId('https://heyzine.com/shelf/a16ec9269b.html', cache), { kind: 'bookshelf', full: 'a16ec9269b8d436092e69be09a107d1d264e9f18' });
  assert.deepEqual(resolveFullId('a16ec9269b8d436092e69be09a107d1d264e9f18', cache), { kind: 'bookshelf', full: 'a16ec9269b8d436092e69be09a107d1d264e9f18' });
  assert.equal(resolveFullId('deadbeef00', cache), null);
});

test('reconcile classifies exists, ambiguous and missing with public host urls', () => {
  const E = item('2222222222aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf', 'Medit i900 Intraoral Scanner Review PDF');
  const cache = cacheOf([A, B, C, D, E]);
  cache.items[1].register.fields.idd_to = 'cadcam-materials-overview';
  const rows = reconcile(['CAD/CAM Chairside Materials Overview', 'Medit i900 Intraoral Scanner Review', 'Nothing like this at all'], cache, { publicHost: 'docs.aflip.in' });
  assert.equal(rows[0].status, 'exists');
  assert.equal(rows[0].short, 'a1b2c3d4e5');
  assert.equal(rows[0].url, 'https://docs.aflip.in/a1b2c3d4e5.html');
  assert.equal(rows[0].idd_to, 'cadcam-materials-overview');
  assert.equal(rows[1].status, 'ambiguous');
  assert.equal(rows[1].candidates.length, 2);
  assert.equal(rows[1].id, '');
  assert.equal(rows[2].status, 'missing');
  assert.equal(rows[2].id, '');
});

test('parseNamesFile drops alignment rows and reads the name column in any casing or quoting', () => {
  const md = ['| Anchor name | Slug |', '|:---|---:|', '| Medit i900 Review | a |', '| 3DISC Heron Review | b |'].join('\n');
  assert.deepEqual(parseNamesFile(md), ['Medit i900 Review', '3DISC Heron Review']);
  assert.deepEqual(parseNamesFile('Name,Slug\nMedit i900 Review,a\n'), ['Medit i900 Review']);
  assert.deepEqual(parseNamesFile('"name","slug"\n"A, B",x\n'), ['A, B']);
});

const stub = (ids) => ids.map((id) => ({ id, title: id, pages: 1, links: {} }));
const pagingClient = (pages) => {
  const calls = [];
  return {
    calls,
    listFlipbooks: async (params) => { calls.push(params); return pages(calls.length); },
    flipbookDetails: async (id) => ({ id, tags: '', private: '' }),
    listBookshelves: async () => [],
  };
};

test('refreshInventory pages the flipbook list until a short page', async () => {
  const first = stub(Array.from({ length: 200 }, (_, i) => `first-${i}`));
  const second = stub(['s0', 's1', 's2', 's3', 's4']);
  const client = pagingClient((n) => (n === 1 ? first : second));
  const cache = await refreshInventory(client, { writeFile: async () => {} });
  assert.equal(cache.count, 205);
  assert.equal(client.calls.length, 2);
  assert.deepEqual(client.calls[0], { limit: 200, offset: 0 });
  assert.deepEqual(client.calls[1], { limit: 200, offset: 200 });
});

test('refreshInventory stops and dedupes when the server ignores limit and offset', async () => {
  const same = stub(Array.from({ length: 200 }, (_, i) => `same-${i}`));
  const client = pagingClient(() => same);
  const cache = await refreshInventory(client, { writeFile: async () => {} });
  assert.equal(cache.count, 200);
  assert.equal(client.calls.length, 2);
  const short = pagingClient(() => stub(['a', 'b', 'c']));
  const small = await refreshInventory(short, { writeFile: async () => {} });
  assert.equal(small.count, 3);
  assert.equal(short.calls.length, 1);
});

test('resolveFullId resolves a custom domain slug and a bookshelf slug', () => {
  const G = item('4444444444aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf', 'Slugged Guide', { links: { custom: 'https://docs.example.com/my-slug', base: 'https://heyzine.com/flip-book/4444444444.html' } });
  const cache = cacheOf([A, G]);
  cache.bookshelves[0].links = { url: 'https://heyzine.com/shelf/perfect-ceramic-processing-pdfs' };
  assert.deepEqual(resolveFullId('https://docs.example.com/my-slug', cache), { kind: 'flipbook', full: G.id });
  assert.deepEqual(resolveFullId('https://heyzine.com/shelf/perfect-ceramic-processing-pdfs', cache), { kind: 'bookshelf', full: 'a16ec9269b8d436092e69be09a107d1d264e9f18' });
});

test('reconcile keeps a lone substring match ambiguous and falls back to the link facet', () => {
  const cache = cacheOf([A, B, C]);
  const [sub] = reconcile(['Chairside Processing of Monolithic Zirconia Restorations'], cache, { publicHost: 'docs.aflip.in' });
  assert.equal(sub.status, 'ambiguous');
  assert.equal(sub.candidates.length, 1);
  assert.equal(sub.candidates[0].tier, 'substring');
  assert.equal(sub.candidates[0].id, C.id);
  assert.equal(sub.id, '');
  const facetCache = cacheOf([item('3333333333aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf', 'Unique Widget Handbook')]);
  facetCache.items[0].register.fields.idd_to = '';
  facetCache.items[0].facets.link = ['widget-handbook'];
  const [row] = reconcile(['Unique Widget Handbook'], facetCache, { publicHost: 'docs.aflip.in' });
  assert.equal(row.status, 'exists');
  assert.equal(row.idd_to, 'widget-handbook');
});

test('matchTitle never substring-matches an untitled or very short flipbook title', () => {
  const untitled = item('4444444444aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf', '');
  const tiny = item('5555555555aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf', 'Scan');
  const r = matchTitle('3Shape TRIOS 4 and TRIOS MOVE Review', [untitled, tiny]);
  assert.equal(r.tier, 'none');
  assert.equal(r.matches.length, 0);
  const [row] = reconcile(['3Shape TRIOS 4 and TRIOS MOVE Review'], cacheOf([untitled, tiny]));
  assert.equal(row.status, 'missing');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  inventoryPath, normaliseTitle, overlap, matchTitle, parseNamesFile, refreshInventory, loadInventory, resolveFullId, reconcile,
} from '../lib/inventory.mjs';

const item = (id, title, extra = {}) => ({ id, title, pages: 1, links: { custom: `https://heyzine.com/flip-book/${id.slice(0, 10)}.html`, base: `https://heyzine.com/flip-book/${id.slice(0, 10)}.html` }, tags: '', private: '', ...extra });
const A = item('<short>9f7530f7df74161a1eddc6f87ebac7.pdf', 'Medit i900 Intraoral Scanner Review', { tags: 'purpose:review,link:ios-review-medit-i900', private: 'idd_to = ios-review-medit-i900' });
const B = item('<short>91f3029d392b65eaf26a5815e3b4e5.pdf', 'CAD/CAM Chairside Materials Overview - the reference account');
const C = item('<short>aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf', 'Chairside Processing of Monolithic Zirconia Restorations - Ceramic Restoration Workflows');
const D = item('1111111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf', 'Medit i900 Classic Review PDF');
const cacheOf = (items) => ({ fetched_at: 'x', count: items.length, items: items.map((i) => ({ ...i, register: { fields: {}, other: [] }, facets: {} })), bookshelves: [{ id: 'a16ec9269b8d436092e69be09a107d1d264e9f18', title: 'Perfect Ceramic Processing PDFs' }], bookshelves_error: null });

test('normaliseTitle strips PDF markers, the reference account suffixes and punctuation', () => {
  assert.equal(normaliseTitle('CAD/CAM Chairside Materials Overview - the reference account'), 'cad cam chairside materials overview');
  assert.equal(normaliseTitle('Medit i900 Classic Review PDF'), 'medit i900 classic review');
  assert.equal(normaliseTitle('Alliedstar AS 260 Review PDF'), 'alliedstar as 260 review');
  assert.equal(normaliseTitle('  Zirconia Guide from Indication to Cementation - the reference account '), 'zirconia guide from indication to cementation');
  assert.equal(normaliseTitle('Formlabs Form 4B Review – Breaking Free'), 'formlabs form 4b review breaking free');
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
  const md = ['# deck', '', '| # | Course | Anchor name | the short domain slug |', '|---|---|---|---|', '| 1 | X | 3DISC Heron Intraoral Scanner Review | ios-review-3disc-heron |', '| 2 | Y | Medit i600 Intraoral Scanner Review | ios-review-medit-i600 |'].join('\n');
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
  assert.deepEqual(resolveFullId('<short>', cache), { kind: 'flipbook', full: A.id });
  assert.deepEqual(resolveFullId('https://docs.aflip.in/<short>.html', cache), { kind: 'flipbook', full: B.id });
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
  assert.equal(rows[0].short, '<short>');
  assert.equal(rows[0].url, 'https://docs.aflip.in/<short>.html');
  assert.equal(rows[0].idd_to, 'cadcam-materials-overview');
  assert.equal(rows[1].status, 'ambiguous');
  assert.equal(rows[1].candidates.length, 2);
  assert.equal(rows[1].id, '');
  assert.equal(rows[2].status, 'missing');
  assert.equal(rows[2].id, '');
});

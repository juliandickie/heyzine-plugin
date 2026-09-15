import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isFullFlipbookId, isFullBookshelfId, shortId, parseId, publicUrl,
  driveFileId, driveDirectUrl, linkConversionUrl, DRIVE_URL_FORMS, safeUrl,
} from '../lib/links.mjs';

const FULL = '<short>91f3029d392b65eaf26a5815e3b4e5.pdf';
const SHELF = 'a16ec9269b8d436092e69be09a107d1d264e9f18';

test('full id detection', () => {
  assert.equal(isFullFlipbookId(FULL), true);
  assert.equal(isFullFlipbookId(SHELF), false);
  assert.equal(isFullBookshelfId(SHELF), true);
  assert.equal(isFullBookshelfId('<short>'), false);
});

test('shortId from every accepted form', () => {
  assert.equal(shortId(FULL), '<short>');
  assert.equal(shortId(SHELF), 'a16ec9269b');
  assert.equal(shortId('FFD194B29C'), '<short>');
  assert.equal(shortId('https://heyzine.com/flip-book/<short>.html'), '<short>');
  assert.equal(shortId('https://heyzine.com/flip-book/<short>.html?x=1#p2'), '<short>');
  assert.equal(shortId('https://docs.aflip.in/<short>.html'), '<short>');
  assert.equal(shortId('https://heyzine.com/shelf/<short>.html'), '<short>');
  assert.equal(shortId('https://heyzine.com/shelf/perfect-ceramic-processing-pdfs'), null);
  assert.equal(shortId('nonsense'), null);
});

test('parseId classifies and extracts slugs for custom paths', () => {
  assert.deepEqual(parseId(FULL), { kind: 'flipbook', full: FULL, short: '<short>', slug: null });
  assert.deepEqual(parseId(SHELF), { kind: 'bookshelf', full: SHELF, short: 'a16ec9269b', slug: null });
  assert.deepEqual(parseId('https://heyzine.com/shelf/perfect-ceramic-processing-pdfs'), { kind: 'bookshelf', full: null, short: null, slug: 'perfect-ceramic-processing-pdfs' });
  assert.deepEqual(parseId('https://docs.aflip.in/<short>.html'), { kind: 'flipbook', full: null, short: '<short>', slug: null });
  assert.equal(parseId('<short>').kind, 'unknown');
  assert.equal(parseId('<short>').short, '<short>');
});

test('publicUrl rewrites onto the white-label host and falls back to the custom link', () => {
  const fb = { id: FULL, links: { custom: 'https://heyzine.com/flip-book/<short>.html', base: 'https://heyzine.com/flip-book/<short>.html' } };
  assert.equal(publicUrl(fb, 'docs.aflip.in'), 'https://docs.aflip.in/<short>.html');
  assert.equal(publicUrl(fb, 'https://docs.aflip.in/'), 'https://docs.aflip.in/<short>.html');
  assert.equal(publicUrl(fb, ''), 'https://heyzine.com/flip-book/<short>.html');
  const custom = { id: FULL, links: { custom: 'https://docs.example.com/my-slug', base: 'https://heyzine.com/flip-book/<short>.html' } };
  assert.equal(publicUrl(custom, ''), 'https://docs.example.com/my-slug');
  assert.equal(publicUrl({ url: 'https://heyzine.com/flip-book/<short>.html' }, 'docs.aflip.in'), 'https://docs.aflip.in/<short>.html');
  assert.equal(publicUrl({}, 'docs.aflip.in'), null);
});

test('driveFileId accepts ids and every common link form', () => {
  const id = '1pPGgWy-nO2vfLY7jypSOIH1QvqyKGYWl';
  assert.equal(driveFileId(id), id);
  assert.equal(driveFileId(`https://drive.google.com/file/d/${id}/view?usp=drivesdk`), id);
  assert.equal(driveFileId(`https://drive.google.com/open?id=${id}`), id);
  assert.equal(driveFileId(`https://drive.google.com/uc?export=download&id=${id}`), id);
  assert.equal(driveFileId('https://example.com/x.pdf'), null);
  assert.equal(driveFileId('short'), null);
});

test('driveDirectUrl builds both forms and rejects unknown ones', () => {
  const id = '1pPGgWy-nO2vfLY7jypSOIH1QvqyKGYWl';
  assert.deepEqual(DRIVE_URL_FORMS, ['usercontent', 'uc']);
  assert.equal(driveDirectUrl(id), `https://drive.usercontent.google.com/download?id=${id}&export=download`);
  assert.equal(driveDirectUrl(`https://drive.google.com/file/d/${id}/view`, { form: 'uc' }), `https://drive.google.com/uc?export=download&id=${id}`);
  assert.throws(() => driveDirectUrl('https://example.com/x.pdf'), /Not a Google Drive file id or link/);
  assert.throws(() => driveDirectUrl(id, { form: 'other' }), /Unknown Drive URL form/);
});

test('linkConversionUrl encodes parameters and maps booleans to 1 and 0', () => {
  const url = linkConversionUrl('https://example.com/a b.pdf', 'd3m0', { title: 'Test title', download: true, share: false, page_effect: 'book', template: 'abc.pdf', logo: '' });
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, 'https://heyzine.com/api1');
  assert.equal(u.searchParams.get('pdf'), 'https://example.com/a b.pdf');
  assert.equal(u.searchParams.get('k'), 'd3m0');
  assert.equal(u.searchParams.get('t'), 'Test title');
  assert.equal(u.searchParams.get('d'), '1');
  assert.equal(u.searchParams.get('sh'), '0');
  assert.equal(u.searchParams.get('pe'), 'book');
  assert.equal(u.searchParams.get('tpl'), 'abc.pdf');
  assert.equal(u.searchParams.has('lg'), false);
  assert.throws(() => linkConversionUrl('https://x/y.pdf', ''), /clientId is required/);
});

test('safeUrl drops the query string and the fragment', () => {
  assert.equal(safeUrl('https://x/y.pdf?token=abc'), 'https://x/y.pdf');
  assert.equal(safeUrl('https://x/y.pdf?token=abc#page=2'), 'https://x/y.pdf');
  assert.equal(safeUrl('https://drive.usercontent.google.com/download?id=abc&export=download'), 'https://drive.usercontent.google.com/download');
  assert.equal(safeUrl('https://x/y.pdf'), 'https://x/y.pdf');
  assert.equal(safeUrl('not a url?token=abc'), 'not a url');
  assert.equal(safeUrl(undefined), '');
});

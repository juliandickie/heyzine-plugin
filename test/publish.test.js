import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PURPOSE_DEFAULTS, sourceToUrl, checkSourceUrl, verifyLive, publishOne, preflightExisting } from '../lib/publish.mjs';

const ID = 'abcdefabcdefabcdefabcdefabcdefabcdefabcd.pdf';

function fakeClient() {
  const calls = [];
  return {
    calls,
    convertAsync: async (p) => { calls.push(['convertAsync', p]); return { id: ID, url: 'https://heyzine.com/flip-book/abcdefabcd.html', thumbnail: 'https://cdn/x.jpg', state: 'processed', meta: { num_pages: 4 } }; },
    setSocial: async (id, f) => { calls.push(['setSocial', id, f]); return { success: true }; },
    flipbookDetails: async (id) => { calls.push(['flipbookDetails', id]); return { id, title: 'Doc', pages: 4, tags: 'purpose:lead-magnet', private: 'x = y', links: { custom: 'https://heyzine.com/flip-book/abcdefabcd.html', base: 'https://heyzine.com/flip-book/abcdefabcd.html', thumbnail: 'https://cdn/x.jpg', pdf: 'https://cdn/x.pdf' }, oembed: { html: '<iframe src="https://heyzine.com/flip-book/abcdefabcd.html"></iframe>' } }; },
  };
}
const okFetch = async (url) => ({ status: 200, ok: true, headers: { get: () => null }, text: async () => '', body: { cancel: async () => {} } });
const ctxOf = (client, overrides = {}) => ({ client, settings: { clientId: 'cid', publicHost: 'docs.aflip.in', templateId: 'tpl.pdf', urlDomain: '', defaultTags: 'published-by:heyzine-plugin' }, fetch: okFetch, today: () => '2026-09-15', pollOptions: { sleep: async () => {} }, ...overrides });

test('purpose defaults exist for every purpose', () => {
  for (const p of ['lead-magnet', 'course-material', 'review', 'event', 'catalog', 'other']) assert.ok(p in PURPOSE_DEFAULTS, p);
  assert.equal(PURPOSE_DEFAULTS['lead-magnet'].download, true);
  assert.equal(PURPOSE_DEFAULTS['course-material'].download, false);
});

test('sourceToUrl maps Drive ids and links, passes http URLs, rejects local paths', () => {
  const id = '1pPGgWy-nO2vfLY7jypSOIH1QvqyKGYWl';
  assert.deepEqual(sourceToUrl(id), { url: `https://drive.usercontent.google.com/download?id=${id}&export=download`, driveId: id });
  assert.deepEqual(sourceToUrl(`https://drive.google.com/file/d/${id}/view`, { driveForm: 'uc' }), { url: `https://drive.google.com/uc?export=download&id=${id}`, driveId: id });
  assert.deepEqual(sourceToUrl('https://example.com/a.pdf'), { url: 'https://example.com/a.pdf', driveId: null });
  assert.throws(() => sourceToUrl('/Users/me/file.pdf'), (e) => e.code === 'validation' && /staged/.test(e.message));
  assert.throws(() => sourceToUrl('file.pdf'), (e) => e.code === 'validation');
});

test('checkSourceUrl flags redirects, non-200 and odd content types', async () => {
  const mk = (status, headers) => async () => ({ status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, body: { cancel: async () => {} } });
  assert.deepEqual(await checkSourceUrl('u', { fetch: mk(200, { 'content-type': 'application/pdf' }) }), { status: 200, contentType: 'application/pdf', redirect: false, location: null, ok: true, warning: null });
  const r = await checkSourceUrl('u', { fetch: mk(303, { location: 'https://elsewhere' }) });
  assert.equal(r.ok, false); assert.match(r.warning, /redirects to https:\/\/elsewhere/);
  assert.match((await checkSourceUrl('u', { fetch: mk(404, {}) })).warning, /HTTP 404/);
  assert.match((await checkSourceUrl('u', { fetch: mk(200, { 'content-type': 'text/html' }) })).warning, /content-type text\/html/);
});

test('publishOne stages, converts with register fields, sets social, verifies and reports both URLs', async () => {
  const client = fakeClient();
  const r = await publishOne(ctxOf(client), { source: '1pPGgWy-nO2vfLY7jypSOIH1QvqyKGYWl', name: 'Doc', purpose: 'lead-magnet', iddTo: 'doc-magnet', description: 'A doc', note: 'hand note' });
  const [, params] = client.calls.find((c) => c[0] === 'convertAsync');
  assert.equal(params.client_id, 'cid');
  assert.equal(params.template, 'tpl.pdf');
  assert.equal(params.title, 'Doc');
  assert.equal(params.download, true);
  assert.equal(params.tags, 'published-by:heyzine-plugin,purpose:lead-magnet,link:doc-magnet,source:drive');
  assert.match(params.private_note, /source_drive_id = 1pPGgWy-nO2vfLY7jypSOIH1QvqyKGYWl/);
  assert.match(params.private_note, /idd_to = doc-magnet/);
  assert.match(params.private_note, /hand note$/);
  assert.equal('replace' in params, false);
  const social = client.calls.find((c) => c[0] === 'setSocial');
  assert.deepEqual(social[2], { title: 'Doc', description: 'A doc', thumbnail: 'https://cdn/x.jpg' });
  assert.equal(r.id, ID);
  assert.equal(r.short, 'abcdefabcd');
  assert.equal(r.url, 'https://docs.aflip.in/abcdefabcd.html');
  assert.equal(r.base, 'https://heyzine.com/flip-book/abcdefabcd.html');
  assert.equal(r.pages, 4);
  assert.match(r.oembed, /<iframe/);
  assert.equal(r.verify.length, 2);
  assert.ok(r.verify.every((v) => v.ok));
});

test('publishOne honours replace, explicit design overrides and skipVerify', async () => {
  const client = fakeClient();
  const r = await publishOne(ctxOf(client), { source: 'https://x/y.pdf', name: 'Doc', purpose: 'course-material', replace: true, design: { download: true, page_effect: 'book' }, template: 'other.pdf', urlPath: 'my-doc', skipVerify: true });
  const [, params] = client.calls.find((c) => c[0] === 'convertAsync');
  assert.equal(params.replace, true);
  assert.equal(params.download, true);
  assert.equal(params.page_effect, 'book');
  assert.equal(params.template, 'other.pdf');
  assert.equal(params.url_path, 'my-doc');
  assert.equal(params.tags.includes('source:url'), true);
  assert.deepEqual(r.verify, []);
  assert.equal(r.replaced, true);
});

test('preflightExisting finds by drive id in the register, then by exact title', () => {
  const cache = { items: [
    { id: 'a.pdf', title: 'Old', register: { fields: { source_drive_id: 'DRIVE1' } }, facets: {} },
    { id: 'b.pdf', title: 'Exact Title Here', register: { fields: {} }, facets: {} },
  ] };
  assert.equal(preflightExisting({ source: 'https://drive.google.com/file/d/DRIVE1xxxxxx/view', name: 'whatever' }, cache), null);
  assert.equal(preflightExisting({ source: 'DRIVE1', name: 'whatever' }, cache)?.id, 'a.pdf');
  assert.equal(preflightExisting({ source: 'https://x/y.pdf', name: 'exact title here' }, cache)?.id, 'b.pdf');
  assert.equal(preflightExisting({ source: 'https://x/y.pdf', name: 'nothing' }, cache), null);
  assert.equal(preflightExisting({ source: 'https://x/y.pdf', name: 'nothing' }, null), null);
});

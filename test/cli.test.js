import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main, COMMANDS, designFields, parseBool, requireNumber } from '../lib/cli.mjs';

const ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678.pdf';
const SHELF = 'a16ec9269b8d436092e69be09a107d1d264e9f18';

// A stdin double - an async iterable of chunks, the shape process.stdin has.
const stdinOf = (...chunks) => (async function* stream() { for (const chunk of chunks) yield chunk; })();

function harness({ client = {}, key = 'K', settings = {}, files = {}, stdin } = {}) {
  const out = []; const err = []; const written = {};
  const deps = {
    env: { HEYZINE_PLUGIN_DATA: '/data' },
    stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) }, stdin,
    resolveKey: async () => ({ key, source: key ? 'file' : 'none', configPath: '/cfg' }),
    resolveSettings: async () => ({ configPath: '/cfg', configExists: true, clientId: 'cid', publicHost: 'docs.aflip.in', templateId: '', urlDomain: '', stagingFolderId: '', defaultTags: '', ...settings }),
    makeClient: () => client,
    readFile: async (p) => { if (p in files) return files[p]; const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; },
    writeFile: async (p, text) => { written[p] = text; },
    mkdir: async () => {},
    fetch: async () => ({ status: 200, ok: true, headers: { get: () => null }, body: { cancel: async () => {} }, text: async () => '' }),
    today: () => '2026-09-15', sleep: async () => {}, now: (() => { let t = 0; return () => (t += 60000); })(),
  };
  return { deps, out, err, written, text: () => out.join(''), errText: () => err.join('') };
}

test('help lists every command and exits 0', async () => {
  const h = harness();
  assert.equal(await main(['help'], h.deps), 0);
  for (const name of Object.keys(COMMANDS)) assert.ok(h.text().includes(name), name);
});

test('parseBool and designFields coerce tri-state flags', () => {
  assert.equal(parseBool('true'), true); assert.equal(parseBool('0'), false); assert.equal(parseBool(undefined), undefined);
  assert.deepEqual(designFields({ title: 'T', download: 'false', 'page-effect': 'book', 'private-note': 'n', rtl: '1', 'background-color': 'ffffff' }), { title: 'T', download: false, page_effect: 'book', private_note: 'n', rtl: true, background_color: 'ffffff' });
});

test('whoami reports key source, counts and gates without printing the key', async () => {
  const client = { listFlipbooks: async () => [{ id: ID }], listBookshelves: async () => { const e = new Error('Bookshelf tools require a plan that includes bookshelves'); e.code = 'plan'; throw e; } };
  const h = harness({ client, key: 'SECRETKEY' });
  assert.equal(await main(['whoami', '--json'], h.deps), 0);
  const j = JSON.parse(h.text());
  assert.equal(j.key_source, 'file'); assert.equal(j.flipbooks, 1); assert.equal(j.bookshelves, null); assert.match(j.bookshelves_error, /plan/);
  assert.equal(j.public_host, 'docs.aflip.in'); assert.equal(j.client_id_configured, true);
  assert.equal(h.text().includes('SECRETKEY'), false);
});

test('no key configured exits 2 with setup guidance', async () => {
  const h = harness({ key: null });
  assert.equal(await main(['list'], h.deps), 2);
  assert.match(h.errText(), /heyzine:setup|config\.toml/);
});

test('list and details print json and resolve short ids through the account list', async () => {
  const calls = [];
  const client = { listFlipbooks: async () => [{ id: ID, title: 'Doc', pages: 4, links: { base: 'https://heyzine.com/flip-book/a1b2c3d4e5.html' } }], flipbookDetails: async (id) => { calls.push(id); return { id, title: 'Doc', tags: '', private: '', links: { base: 'https://heyzine.com/flip-book/a1b2c3d4e5.html', custom: 'https://heyzine.com/flip-book/a1b2c3d4e5.html' } }; } };
  const h = harness({ client });
  assert.equal(await main(['details', 'a1b2c3d4e5', '--json'], h.deps), 0);
  assert.deepEqual(calls, [ID]);
  assert.equal(JSON.parse(h.text()).public_url, 'https://docs.aflip.in/a1b2c3d4e5.html');
  const h2 = harness({ client });
  assert.equal(await main(['list', '--json'], h2.deps), 0);
  assert.equal(JSON.parse(h2.text())[0].public_url, 'https://docs.aflip.in/a1b2c3d4e5.html');
});

test('unknown short id is a not_found exit 1', async () => {
  const client = { listFlipbooks: async () => [], listBookshelves: async () => [] };
  const h = harness({ client });
  assert.equal(await main(['details', 'deadbeef00'], h.deps), 1);
  assert.match(h.errText(), /not_found/);
});

test('convert maps flags to REST fields and --wait polls', async () => {
  const calls = [];
  const client = { convertAsync: async (p) => { calls.push(p); return { id: ID, url: 'u', state: calls.length > 1 ? 'processed' : 'started' }; } };
  const h = harness({ client });
  assert.equal(await main(['convert', 'https://x/y.pdf', '--wait', '--title', 'T', '--download', 'true', '--tags', 'a,b', '--template', 'tpl.pdf', '--json'], h.deps), 0);
  assert.equal(calls[0].client_id, 'cid'); assert.equal(calls[0].title, 'T'); assert.equal(calls[0].download, true); assert.equal(calls[0].template, 'tpl.pdf');
  assert.equal('replace' in calls[0], false);
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(h.text()).state, 'processed');
});

test('convert --replace runs on the blocking endpoint and never polls', async () => {
  const calls = [];
  const client = {
    convertSync: async (p) => { calls.push(['convertSync', p]); return { id: ID, url: 'u' }; },
    convertAsync: async (p) => { calls.push(['convertAsync', p]); return { id: ID, url: 'u', state: 'processed' }; },
  };
  const h = harness({ client });
  assert.equal(await main(['convert', 'https://x/y.pdf', '--replace', '--wait', '--title', 'T', '--json'], h.deps), 0);
  assert.deepEqual(calls.map((c) => c[0]), ['convertSync']);
  assert.equal(calls[0][1].replace, true); assert.equal(calls[0][1].title, 'T');
  assert.match(h.errText(), /replace runs on the blocking endpoint/);
});

test('design --idd-to rewrites the link facet and the register note', async () => {
  const calls = [];
  const client = {
    flipbookDetails: async (id) => ({ id, title: 'Doc', tags: 'purpose:course-material,link:old,handmade', private: 'source_name = Doc\nhand note' }),
    updateDesign: async (id, fields) => { calls.push([id, fields]); return { success: true }; },
  };
  const h = harness({ client });
  assert.equal(await main(['design', ID, '--idd-to', 'PCP Zirconia'], h.deps), 0);
  const [id, fields] = calls[0];
  assert.equal(id, ID);
  assert.match(fields.tags, /link:pcp-zirconia/);
  assert.equal(fields.tags.includes('link:old'), false);
  assert.match(fields.tags, /purpose:course-material/);
  assert.match(fields.tags, /handmade/);
  assert.match(fields.private_note, /idd_to = pcp-zirconia/);
  assert.match(fields.private_note, /source_name = Doc/);
  assert.match(fields.private_note, /hand note/);
});

test('design --idd-to keeps other design flags given alongside it', async () => {
  const calls = [];
  const client = {
    flipbookDetails: async (id) => ({ id, title: 'Doc', tags: '', private: '' }),
    updateDesign: async (id, fields) => { calls.push(fields); return { success: true }; },
  };
  const h = harness({ client });
  assert.equal(await main(['design', ID, '--idd-to', 'doc', '--download', 'false', '--tags', 'extra'], h.deps), 0);
  assert.equal(calls[0].download, false);
  assert.match(calls[0].tags, /extra/);
  assert.match(calls[0].tags, /link:doc/);
});

test('convert without client_id exits 2', async () => {
  const h = harness({ client: {}, settings: { clientId: '' } });
  assert.equal(await main(['convert', 'https://x/y.pdf'], h.deps), 2);
  assert.match(h.errText(), /client_id/);
});

test('delete refuses without a matching --confirm and deletes with it', async () => {
  const deleted = [];
  const client = { flipbookDetails: async (id) => ({ id, title: 'Exact Title' }), deleteFlipbook: async (id) => { deleted.push(id); return { success: true }; }, listFlipbooks: async () => [{ id: ID }] };
  const h = harness({ client });
  assert.equal(await main(['delete', ID], h.deps), 3);
  assert.equal(await main(['delete', ID, '--confirm', 'Wrong'], h.deps), 3);
  assert.deepEqual(deleted, []);
  assert.equal(await main(['delete', ID, '--confirm', 'Exact Title'], h.deps), 0);
  assert.deepEqual(deleted, [ID]);
});

test('shelf commands resolve the bookshelf and flipbook ids', async () => {
  const calls = [];
  const client = {
    listFlipbooks: async () => [{ id: ID, title: 'Doc' }], listBookshelves: async () => [{ id: SHELF, title: 'PCP', links: { url: 'https://heyzine.com/shelf/perfect-ceramic-processing-pdfs' } }],
    bookshelfFlipbooks: async (id) => { calls.push(['list', id]); return [{ id: ID, position: 0, title: 'Doc', links: { base: 'https://heyzine.com/flip-book/a1b2c3d4e5.html' } }]; },
    addToBookshelf: async (s, f, p) => { calls.push(['add', s, f, p]); return { success: true }; },
    removeFromBookshelf: async (s, f) => { calls.push(['remove', s, f]); return { success: true }; },
  };
  const h = harness({ client });
  assert.equal(await main(['shelf', 'https://heyzine.com/shelf/perfect-ceramic-processing-pdfs', '--json'], h.deps), 0);
  assert.equal(await main(['shelf-add', 'a16ec9269b', 'a1b2c3d4e5', '--position', '1'], h.deps), 0);
  assert.equal(await main(['shelf-remove', SHELF, ID], h.deps), 0);
  assert.deepEqual(calls, [['list', SHELF], ['add', SHELF, ID, 1], ['remove', SHELF, ID]]);
});

test('access commands pass through and never echo the password', async () => {
  const calls = [];
  const client = { listFlipbooks: async () => [{ id: ID }], accessSetup: async (p) => { calls.push(p); return { success: true, msg: 'Access configuration set' }; }, accessAdd: async (p) => { calls.push(p); return { success: true }; }, accessRemove: async (p) => { calls.push(p); return { success: true }; } };
  const h = harness({ client });
  assert.equal(await main(['access-setup', ID, '--mode', 'everyone', '--password', 'Sekrit1'], h.deps), 0);
  assert.equal(await main(['access-add', ID, '--access-type', 'user_pass', '--user', 'a@b.c', '--password', 'Sekrit2', '--type', 'flipbook'], h.deps), 0);
  assert.equal(await main(['access-remove', ID, '--user', 'a@b.c'], h.deps), 0);
  assert.deepEqual(calls[0], { id: ID, mode: 'everyone', password: 'Sekrit1' });
  assert.deepEqual(calls[1], { id: ID, access_type: 'user_pass', user: 'a@b.c', password: 'Sekrit2', type: 'flipbook' });
  assert.deepEqual(calls[2], { id: ID, user: 'a@b.c' });
  assert.equal(h.text().includes('Sekrit'), false);
});

test('search, page-text, oembed, link-url, drive-url and mcp', async () => {
  const client = { listFlipbooks: async () => [{ id: ID }], searchText: async (q) => [{ flipbook: 'a1b2c3d4e5.html', page: 2, text: q }], pageText: async () => 'page text', oembed: async (url) => ({ html: `<iframe src="${url}"></iframe>` }), mcpCall: async (name, args) => ({ name, args }) };
  const h = harness({ client });
  assert.equal(await main(['search', 'zirconia', '--json'], h.deps), 0); assert.equal(JSON.parse(h.text())[0].page, 2);
  const h2 = harness({ client }); assert.equal(await main(['page-text', 'a1b2c3d4e5', '1'], h2.deps), 0); assert.match(h2.text(), /page text/);
  const h3 = harness({ client }); assert.equal(await main(['oembed', 'https://heyzine.com/flip-book/a1b2c3d4e5.html', '--json'], h3.deps), 0); assert.match(JSON.parse(h3.text()).html, /iframe/);
  const h4 = harness({ client }); assert.equal(await main(['link-url', 'https://x/y.pdf', '--title', 'T'], h4.deps), 0); assert.match(h4.text(), /heyzine\.com\/api1\?pdf=/);
  const h5 = harness({ client }); assert.equal(await main(['drive-url', '1pPGgWy-nO2vfLY7jypSOIH1QvqyKGYWl'], h5.deps), 0); assert.match(h5.text(), /drive\.usercontent\.google\.com/);
  const h6 = harness({ client }); assert.equal(await main(['mcp', 'heyzine_list_flipbooks', '--args', '{"limit":2}', '--json'], h6.deps), 0); assert.deepEqual(JSON.parse(h6.text()), { name: 'heyzine_list_flipbooks', args: { limit: 2 } });
});

test('inventory --refresh writes the cache and reconcile reads a names file', async () => {
  const client = { listFlipbooks: async () => [{ id: ID, title: 'Medit i900 Intraoral Scanner Review', links: { base: 'https://heyzine.com/flip-book/a1b2c3d4e5.html' } }], flipbookDetails: async (id) => ({ id, title: 'Medit i900 Intraoral Scanner Review', tags: '', private: '', links: { base: 'https://heyzine.com/flip-book/a1b2c3d4e5.html', custom: 'https://heyzine.com/flip-book/a1b2c3d4e5.html' } }), listBookshelves: async () => [] };
  const h = harness({ client, files: { '/names.txt': 'Medit i900 Intraoral Scanner Review\nMissing One\n' } });
  assert.equal(await main(['inventory', '--refresh', '--json'], h.deps), 0);
  assert.ok(h.written['/data/inventory.json']);
  const h2 = harness({ client, files: { '/data/inventory.json': h.written['/data/inventory.json'], '/names.txt': 'Medit i900 Intraoral Scanner Review\nMissing One\n' } });
  assert.equal(await main(['reconcile', '/names.txt', '--json'], h2.deps), 0);
  const rows = JSON.parse(h2.text());
  assert.equal(rows[0].status, 'exists'); assert.equal(rows[1].status, 'missing');
});

test('a corrupt inventory cache is a usage error that names the fix', async () => {
  const h = harness({ client: { listFlipbooks: async () => [] }, files: { '/data/inventory.json': '{ not json' } });
  assert.equal(await main(['inventory'], h.deps), 2);
  assert.match(h.errText(), /usage: Inventory cache is unreadable .* run: heyzine inventory --refresh/);
});

test('batch refuses more than five rows without --yes and writes results next to the input', async () => {
  const six = 'name,source\n' + Array.from({ length: 6 }, (_, i) => `Doc ${i},https://x/${i}.pdf`).join('\n') + '\n';
  const h = harness({ client: {}, files: { '/in/batch.csv': six } });
  assert.equal(await main(['batch', '/in/batch.csv'], h.deps), 3);
  assert.match(h.errText(), /scope review|--yes/);
  const client = { convertAsync: async () => ({ id: ID, url: 'u', state: 'processed', thumbnail: 't' }), setSocial: async () => ({ success: true }), flipbookDetails: async (id) => ({ id, title: 'Doc', pages: 1, links: { base: 'https://heyzine.com/flip-book/a1b2c3d4e5.html', custom: 'https://heyzine.com/flip-book/a1b2c3d4e5.html' } }) };
  const h2 = harness({ client, files: { '/in/batch.csv': 'name,source\nOne,https://x/1.pdf\n' } });
  assert.equal(await main(['batch', '/in/batch.csv', '--skip-verify', '--json'], h2.deps), 0);
  assert.ok(h2.written['/in/batch.results.csv']);
  assert.equal(JSON.parse(h2.text()).summary.converted, 1);
});

test('publish command runs the end to end flow', async () => {
  const client = { convertAsync: async () => ({ id: ID, url: 'u', state: 'processed', thumbnail: 't' }), setSocial: async () => ({ success: true }), flipbookDetails: async (id) => ({ id, title: 'Doc', pages: 1, links: { base: 'https://heyzine.com/flip-book/a1b2c3d4e5.html', custom: 'https://heyzine.com/flip-book/a1b2c3d4e5.html' }, oembed: { html: '<iframe></iframe>' } }) };
  const h = harness({ client });
  assert.equal(await main(['publish', 'https://x/1.pdf', '--name', 'Doc', '--purpose', 'lead-magnet', '--idd-to', 'doc', '--json'], h.deps), 0);
  const r = JSON.parse(h.text());
  assert.equal(r.url, 'https://docs.aflip.in/a1b2c3d4e5.html'); assert.equal(r.verify.length, 2);
});

test('publish stops before converting when the source URL answers an error', async () => {
  const converted = [];
  const client = { convertAsync: async () => { converted.push('called'); return { id: ID, url: 'u', state: 'processed' }; } };
  const h = harness({ client });
  let call = 0;
  h.deps.fetch = async () => { call += 1; return { status: call === 1 ? 404 : 200, ok: call !== 1, headers: { get: () => null }, body: { cancel: async () => {} }, text: async () => '' }; };
  assert.equal(await main(['publish', 'https://x/missing.pdf', '--name', 'Doc', '--purpose', 'lead-magnet'], h.deps), 1);
  assert.match(h.errText(), /validation: Source URL answered HTTP 404: https:\/\/x\/missing\.pdf/);
  assert.deepEqual(converted, []);
});

test('plan errors exit 1 with the server message verbatim', async () => {
  const client = { listFlipbooks: async () => [{ id: ID }], updateDesign: async () => { const e = new Error('Requires a plan with custom URLs'); e.code = 'plan'; throw e; } };
  const h = harness({ client });
  assert.equal(await main(['design', ID, '--url-path', 'x'], h.deps), 1);
  assert.match(h.errText(), /plan: Requires a plan with custom URLs/);
});

test('CLI argument errors are usage errors that exit 2', async () => {
  const h = harness({ client: { listFlipbooks: async () => [{ id: ID }] } });
  assert.equal(await main(['details'], h.deps), 2);
  assert.match(h.errText(), /usage: Missing argument: flipbook id/);
  const h2 = harness({ client: { mcpCall: async () => ({}) } });
  assert.equal(await main(['mcp', 'heyzine_list_flipbooks', '--args', '{bad'], h2.deps), 2);
  assert.match(h2.errText(), /usage: --args is not valid JSON/);
  const h3 = harness({ client: { listFlipbooks: async () => [{ id: ID }] } });
  assert.equal(await main(['design', ID], h3.deps), 2);
  assert.match(h3.errText(), /usage: No design fields given/);
});

test('a full id of the wrong kind is a usage error, not a lookup', async () => {
  const listed = [];
  const client = { listBookshelves: async () => { listed.push('shelves'); return []; }, bookshelfFlipbooks: async () => [] };
  const h = harness({ client });
  assert.equal(await main(['shelf', ID], h.deps), 2);
  assert.match(h.errText(), /usage: .* is a flipbook id, expected a bookshelf id/);
  assert.deepEqual(listed, []);
});

test('render honours --json for string results', async () => {
  const client = { listFlipbooks: async () => [{ id: ID }], pageText: async () => 'page text' };
  const h = harness({ client });
  assert.equal(await main(['page-text', 'a1b2c3d4e5', '1', '--json'], h.deps), 0);
  assert.equal(JSON.parse(h.text()), 'page text');
});

test('reconcile --csv renders the spreadsheet shape', async () => {
  const client = { listFlipbooks: async () => [{ id: ID, title: 'Medit i900 Intraoral Scanner Review', links: { base: 'https://heyzine.com/flip-book/a1b2c3d4e5.html' } }], flipbookDetails: async (id) => ({ id, title: 'Medit i900 Intraoral Scanner Review', tags: '', private: '', links: { base: 'https://heyzine.com/flip-book/a1b2c3d4e5.html', custom: 'https://heyzine.com/flip-book/a1b2c3d4e5.html' } }), listBookshelves: async () => [] };
  const seed = harness({ client });
  assert.equal(await main(['inventory', '--refresh'], seed.deps), 0);
  const h = harness({ client, files: { '/data/inventory.json': seed.written['/data/inventory.json'], '/names.txt': 'Medit i900 Intraoral Scanner Review\nMissing One\n' } });
  assert.equal(await main(['reconcile', '/names.txt', '--csv'], h.deps), 0);
  const lines = h.text().trim().split('\n');
  assert.equal(lines[0], 'name,status,id,short,title,url,idd_to,candidates');
  assert.match(lines[1], /^Medit i900 Intraoral Scanner Review,exists,a1b2c3d4e5f60718293a4b5c6d7e8f9012345678\.pdf,a1b2c3d4e5,/);
  assert.match(lines[1], /https:\/\/docs\.aflip\.in\/a1b2c3d4e5\.html/);
  assert.match(lines[1], /a1b2c3d4e5 Medit i900 Intraoral Scanner Review \(exact\)/);
  assert.match(lines[2], /^Missing One,missing,/);
});

test('requireNumber accepts finite numbers and refuses everything else', () => {
  assert.equal(requireNumber('2', '--position'), 2);
  assert.equal(requireNumber('0', '--position'), 0);
  assert.equal(requireNumber('-1.5', '--position'), -1.5);
  for (const bad of ['two', '', '   ', undefined, null, 'NaN', 'Infinity', '1px']) {
    assert.throws(() => requireNumber(bad, '--position'), (e) => e.code === 'usage' && /--position must be a number/.test(e.message));
  }
});

test('a non-numeric --position is a usage error and nothing is added to the shelf', async () => {
  const calls = [];
  const client = {
    listFlipbooks: async () => [{ id: ID, title: 'Doc' }],
    listBookshelves: async () => [{ id: SHELF, title: 'PCP' }],
    addToBookshelf: async (...args) => { calls.push(args); return { success: true }; },
  };
  const h = harness({ client });
  assert.equal(await main(['shelf-add', SHELF, ID, '--position', 'two'], h.deps), 2);
  assert.match(h.errText(), /usage: --position must be a number, got "two"/);
  assert.deepEqual(calls, [], 'addToBookshelf must never be reached');
  const ok = harness({ client });
  assert.equal(await main(['shelf-add', SHELF, ID, '--position', '3'], ok.deps), 0);
  assert.deepEqual(calls, [[SHELF, ID, 3]]);
});

test('a non-numeric page, limit, offset, maxwidth, maxheight or concurrency exits 2', async () => {
  const client = { listFlipbooks: async () => [{ id: ID }], pageText: async () => 'text', oembed: async () => ({ html: '' }) };
  const cases = [
    [['page-text', ID, 'x'], /<page> must be a number, got "x"/],
    [['list', '--limit', 'ten'], /--limit must be a number/],
    [['list', '--offset', 'ten'], /--offset must be a number/],
    [['oembed', 'https://heyzine.com/flip-book/a1b2c3d4e5.html', '--maxwidth', 'wide'], /--maxwidth must be a number/],
    [['oembed', 'https://heyzine.com/flip-book/a1b2c3d4e5.html', '--maxheight', 'tall'], /--maxheight must be a number/],
  ];
  for (const [argv, pattern] of cases) {
    const h = harness({ client });
    assert.equal(await main(argv, h.deps), 2, argv.join(' '));
    assert.match(h.errText(), /usage: /);
    assert.match(h.errText(), pattern);
  }
  const batch = harness({ client, files: { '/in/batch.csv': 'name,source\nOne,https://x/1.pdf\n' } });
  assert.equal(await main(['batch', '/in/batch.csv', '--concurrency', 'lots'], batch.deps), 2);
  assert.match(batch.errText(), /usage: --concurrency must be a number/);
});

test('--password-stdin keeps the password out of the argv and out of the output', async () => {
  const calls = [];
  const client = { listFlipbooks: async () => [{ id: ID }], accessAdd: async (p) => { calls.push(p); return { success: true, msg: 'Access entry added' }; } };
  const h = harness({ client, stdin: stdinOf('Sekrit9\n') });
  assert.equal(await main(['access-add', ID, '--access-type', 'pass_only', '--password-stdin'], h.deps), 0);
  assert.deepEqual(calls[0], { id: ID, access_type: 'pass_only', password: 'Sekrit9' });
  assert.equal(h.text().includes('Sekrit9'), false);
  assert.equal(h.errText().includes('Sekrit9'), false);
});

test('--password-stdin works on access-setup and access-remove, takes the first line only, and refuses an empty one', async () => {
  const calls = [];
  const client = {
    listFlipbooks: async () => [{ id: ID }],
    accessSetup: async (p) => { calls.push(p); return { success: true }; },
    accessRemove: async (p) => { calls.push(p); return { success: true }; },
  };
  const setup = harness({ client, stdin: stdinOf('Shared1\r\ntrailing junk\n') });
  assert.equal(await main(['access-setup', ID, '--mode', 'everyone', '--password-stdin'], setup.deps), 0);
  assert.deepEqual(calls[0], { id: ID, mode: 'everyone', password: 'Shared1' });
  const remove = harness({ client, stdin: stdinOf(Buffer.from('Sekrit9\n')) });
  assert.equal(await main(['access-remove', ID, '--password-stdin'], remove.deps), 0);
  assert.deepEqual(calls[1], { id: ID, password: 'Sekrit9' });
  const empty = harness({ client, stdin: stdinOf('\n') });
  assert.equal(await main(['access-add', ID, '--access-type', 'pass_only', '--password-stdin'], empty.deps), 2);
  assert.match(empty.errText(), /usage: --password-stdin read an empty password/);
  const both = harness({ client, stdin: stdinOf('Sekrit9\n') });
  assert.equal(await main(['access-add', ID, '--access-type', 'pass_only', '--password', 'x', '--password-stdin'], both.deps), 2);
  assert.match(both.errText(), /usage: Pass either --password or --password-stdin, not both/);
});

test('the live id fallback pages through the whole account, not just the first page', async () => {
  const page1 = Array.from({ length: 200 }, (_, i) => ({ id: `${String(i).padStart(4, '0')}${'a'.repeat(36)}.pdf`, title: `Doc ${i}` }));
  const wanted = { id: ID, title: 'On page two', links: { base: 'https://heyzine.com/flip-book/a1b2c3d4e5.html', custom: 'https://heyzine.com/flip-book/a1b2c3d4e5.html' } };
  const queries = [];
  const client = {
    listFlipbooks: async (q = {}) => { queries.push(q); return queries.length === 1 ? page1 : [wanted]; },
    listBookshelves: async () => [],
    flipbookDetails: async (id) => ({ ...wanted, id, tags: '', private: '' }),
  };
  const h = harness({ client });
  assert.equal(await main(['details', 'a1b2c3d4e5', '--json'], h.deps), 0);
  assert.equal(JSON.parse(h.text()).id, ID);
  assert.deepEqual(queries.map((q) => q.offset), [0, 200]);
});

test('an inventory cache of the wrong shape is unreadable, not an empty account', async () => {
  // A file holding a literal null is indistinguishable from an absent one and refreshes instead.
  for (const body of ['{"count":0}', '[]', '{"items":{},"bookshelves":[]}', '{"items":[]}', '{"bookshelves":[]}']) {
    const h = harness({ client: { listFlipbooks: async () => [] }, files: { '/data/inventory.json': body } });
    assert.equal(await main(['inventory'], h.deps), 2, body);
    assert.match(h.errText(), /usage: Inventory cache is unreadable .* run: heyzine inventory --refresh/);
  }
});

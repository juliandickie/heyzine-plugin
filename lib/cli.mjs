import { parseArgs } from 'node:util';
import { readFile as fsReadFile, writeFile as fsWriteFile, mkdir as fsMkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { resolveKey as defaultResolveKey, resolveSettings as defaultResolveSettings, dataDir, ConfigError } from './config.mjs';
import { HeyzineClient, HeyzineError } from './client.mjs';
import { convertParams, convertAndWait } from './convert.mjs';
import { publicUrl, shortId, parseId, driveDirectUrl, linkConversionUrl, isFullFlipbookId, isFullBookshelfId, safeUrl } from './links.mjs';
import { parseNote, tagFacets, mergeTags, mergeNote, slugValue, assertNote } from './register.mjs';
import { refreshInventory, loadInventory, inventoryPath, resolveFullId, reconcile, parseNamesFile, listAllFlipbooks } from './inventory.mjs';
import { publishOne, sourceToUrl, checkSourceUrl } from './publish.mjs';
import { runBatch, resultsCsv } from './batch.mjs';
import { parseCsv, toCsv } from './csv.mjs';

export const BATCH_REVIEW_THRESHOLD = 5;

// reconcile --csv columns. candidates is flattened to one cell so the file opens in Sheets.
export const RECONCILE_COLUMNS = ['name', 'status', 'id', 'short', 'title', 'url', 'idd_to', 'candidates'];

const STRING_FLAGS = [
  'title', 'subtitle', 'description', 'private-note', 'tags', 'template', 'background-color', 'logo', 'page-effect', 'url-path', 'url-domain',
  'download', 'full-screen', 'share', 'prev-next', 'show-info', 'rtl',
  'thumbnail', 'mode', 'type', 'password', 'text-user', 'text-password', 'access-type', 'user', 'position', 'limit', 'offset',
  'args', 'confirm', 'name', 'purpose', 'course', 'idd-to', 'note', 'out', 'form', 'maxwidth', 'maxheight', 'concurrency', 'embedded',
];
const BOOL_FLAGS = ['json', 'wait', 'replace', 'refresh', 'yes', 'csv', 'help', 'skip-verify', 'password-stdin'];

const DESIGN_MAP = {
  title: 'title', subtitle: 'subtitle', description: 'description', 'private-note': 'private_note', tags: 'tags', template: 'template',
  'background-color': 'background_color', logo: 'logo', 'page-effect': 'page_effect', 'url-path': 'url_path', 'url-domain': 'url_domain',
  download: 'download', 'full-screen': 'full_screen', share: 'share', 'prev-next': 'prev_next', 'show-info': 'show_info', rtl: 'rtl',
};
const BOOL_FIELDS = new Set(['download', 'full_screen', 'share', 'prev_next', 'show_info', 'rtl']);

export function parseBool(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const s = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(s)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(s)) return false;
  throw new HeyzineError('usage', `Expected true or false, got "${value}"`);
}

// parseArgs hands every flag through as a string, so a typo like --position two used to reach
// the API as NaN and be dropped. Numbers are checked at the boundary instead.
export function requireNumber(value, flagName) {
  const n = Number(String(value ?? '').trim());
  if (value === undefined || value === null || String(value).trim() === '' || !Number.isFinite(n)) {
    throw new HeyzineError('usage', `${flagName} must be a number, got "${value}"`);
  }
  return n;
}

export function designFields(flags) {
  const out = {};
  for (const [flag, field] of Object.entries(DESIGN_MAP)) {
    const value = flags[flag];
    if (value === undefined || value === '') continue;
    out[field] = BOOL_FIELDS.has(field) ? parseBool(value) : value;
  }
  return out;
}

function parse(argv) {
  const options = {};
  for (const f of STRING_FLAGS) options[f] = { type: 'string' };
  for (const f of BOOL_FLAGS) options[f] = { type: 'boolean' };
  const { values, positionals } = parseArgs({ args: argv, options, allowPositionals: true, strict: true });
  return { flags: values, positionals };
}

function withPublic(item, publicHost) { return { ...item, public_url: publicUrl(item, publicHost) }; }

// loadInventory returns null when the cache file is absent and throws on a corrupt one,
// so a half written or hand edited cache reports loudly with the command that repairs it.
// Valid JSON of the wrong shape is just as unusable, and would otherwise read as an empty
// account, so the two arrays every reader indexes into are checked here too.
async function readInventory(ctx) {
  let cache;
  try {
    cache = await loadInventory({ dir: ctx.dataDir, readFile: ctx.readFile });
  } catch (error) {
    throw new HeyzineError('usage', `Inventory cache is unreadable (${error.message}) - run: heyzine inventory --refresh`);
  }
  if (cache === null || cache === undefined) return null;
  if (!Array.isArray(cache.items) || !Array.isArray(cache.bookshelves)) {
    throw new HeyzineError('usage', 'Inventory cache is unreadable (no items or bookshelves array) - run: heyzine inventory --refresh');
  }
  return cache;
}

// Passwords given with --password sit in the process list and in the session transcript.
// --password-stdin takes the first line of stdin instead, which reaches neither.
async function readPasswordStdin(ctx) {
  const stream = ctx.stdin;
  if (!stream) throw new HeyzineError('usage', '--password-stdin needs a readable stdin');
  let text = '';
  for await (const chunk of stream) text += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
  const first = text.split('\n')[0].replace(/\r$/, '');
  if (first === '') throw new HeyzineError('usage', '--password-stdin read an empty password from stdin');
  return first;
}

async function passwordOf(ctx, flags) {
  if (flags['password-stdin'] && flags.password !== undefined) {
    throw new HeyzineError('usage', 'Pass either --password or --password-stdin, not both');
  }
  return flags['password-stdin'] ? readPasswordStdin(ctx) : flags.password;
}

// Heyzine fetches the source itself, so a source it cannot read fails minutes later as a
// conversion error. One cheap ranged GET up front turns that into a clear refusal.
async function preflightSource(ctx, source) {
  const { url } = sourceToUrl(source, { driveForm: 'usercontent' });
  const result = await checkSourceUrl(url, { fetch: ctx.fetch });
  if (result.status >= 400) throw new HeyzineError('validation', `Source URL answered HTTP ${result.status}: ${safeUrl(url)}`);
  if (result.warning) ctx.stderr.write(`heyzine: source warning - ${result.warning}\n`);
  return result;
}

async function resolveId(ctx, input, expectKind) {
  const s = String(input ?? '').trim();
  if (!s) throw new HeyzineError('usage', 'An id, short id or URL is required');
  if (isFullFlipbookId(s) || isFullBookshelfId(s)) {
    // The two id shapes are distinguishable on sight, so a mismatch is a typed command, not a lookup miss.
    const kind = isFullFlipbookId(s) ? 'flipbook' : 'bookshelf';
    if (expectKind && kind !== expectKind) throw new HeyzineError('usage', `"${s}" is a ${kind} id, expected a ${expectKind} id`);
    return s.toLowerCase();
  }
  const cache = await readInventory(ctx);
  let hit = resolveFullId(s, cache);
  if (!hit) {
    const kind = expectKind ?? parseId(s).kind;
    const live = { items: [], bookshelves: [] };
    if (kind !== 'bookshelf') live.items = await listAllFlipbooks(ctx.client);
    if (kind !== 'flipbook') live.bookshelves = await ctx.client.listBookshelves().catch(() => []);
    hit = resolveFullId(s, live);
  }
  if (!hit) throw new HeyzineError('not_found', `"${s}" is not a flipbook or bookshelf in this account (tried the inventory cache and the live list)`);
  if (expectKind && hit.kind !== expectKind) throw new HeyzineError('usage', `"${s}" is a ${hit.kind}, expected a ${expectKind}`);
  return hit.full;
}

function requireArg(positionals, index, what) {
  const v = positionals[index];
  if (v === undefined || v === '') throw new HeyzineError('usage', `Missing argument: ${what}`);
  return v;
}

export const COMMANDS = {
  help: { usage: 'help', needsKey: false, run: async () => helpText() },
  whoami: { usage: 'whoami', needsKey: true, run: async (ctx) => {
    const list = await ctx.client.listFlipbooks();
    let bookshelves = null; let bookshelvesError = null;
    try { bookshelves = (await ctx.client.listBookshelves()).length; } catch (e) { bookshelvesError = `${e.code}: ${e.message}`; }
    return { key_source: ctx.keySource, config_path: ctx.settings.configPath, client_id_configured: Boolean(ctx.settings.clientId), public_host: ctx.settings.publicHost || null, template_id: ctx.settings.templateId || null, staging_folder_id: ctx.settings.stagingFolderId || null, flipbooks: list.length, bookshelves, bookshelves_error: bookshelvesError, data_dir: ctx.dataDir };
  } },
  list: { usage: 'list [--limit N] [--offset N]', needsKey: true, run: async (ctx, p, f) => {
    const limit = f.limit === undefined ? undefined : requireNumber(f.limit, '--limit');
    const offset = f.offset === undefined ? undefined : requireNumber(f.offset, '--offset');
    return (await ctx.client.listFlipbooks({ limit, offset })).map((i) => withPublic(i, ctx.settings.publicHost));
  } },
  details: { usage: 'details <id|short|url>', needsKey: true, run: async (ctx, p) => {
    const id = await resolveId(ctx, requireArg(p, 0, 'flipbook id'), 'flipbook');
    const d = await ctx.client.flipbookDetails(id);
    return { ...withPublic(d, ctx.settings.publicHost), register: parseNote(d.private ?? ''), facets: tagFacets(d.tags ?? '').facets };
  } },
  convert: { usage: 'convert <url> [--wait] [--replace] [design flags]', needsKey: true, run: async (ctx, p, f) => {
    const params = convertParams({ pdf: requireArg(p, 0, 'document URL'), clientId: ctx.settings.clientId, ...designFields(f), template: f.template || ctx.settings.templateId || undefined, replace: f.replace ? true : undefined });
    if (f.replace) {
      // Only the blocking endpoint actually stores a new edition under the same id, so --wait has nothing to poll.
      ctx.stderr.write('heyzine: replace runs on the blocking endpoint, this can take a while for large documents\n');
      return ctx.client.convertSync(params);
    }
    if (f.wait) return convertAndWait(ctx.client, params, { sleep: ctx.sleep, onPoll: (r, n) => ctx.stderr.write(`heyzine: poll ${n} state ${r.state ?? 'unknown'}\n`) });
    return ctx.client.convertAsync(params);
  } },
  publish: { usage: 'publish <source> --name <name> [--purpose P] [--course C] [--idd-to slug] [--template id] [--replace] [--note text] [--description text] [--embedded list] [--skip-verify] [design flags]', needsKey: true, run: async (ctx, p, f) => {
    if (!f.name) throw new HeyzineError('usage', '--name is required (the resource name that becomes the title)');
    const source = requireArg(p, 0, 'source (Drive id, Drive link or public URL)');
    await preflightSource(ctx, source);
    return publishOne(ctx, { source, name: f.name, purpose: f.purpose, course: f.course, iddTo: f['idd-to'], template: f.template, urlPath: f['url-path'], urlDomain: f['url-domain'], replace: Boolean(f.replace), tags: f.tags, note: f.note, description: f.description, embedded: f.embedded, design: designFields({ ...f, title: undefined, description: undefined, tags: undefined, 'private-note': undefined, template: undefined, 'url-path': undefined, 'url-domain': undefined }), skipVerify: Boolean(f['skip-verify']) });
  } },
  design: { usage: 'design <id> [--idd-to slug] [design flags]', needsKey: true, run: async (ctx, p, f) => {
    const id = await resolveId(ctx, requireArg(p, 0, 'flipbook id'), 'flipbook');
    const fields = designFields(f);
    if (f['idd-to']) {
      // The register lives on the flipbook, so recording a short link is a read, a merge and a write.
      // Any --tags or --private-note given alongside are merged in rather than dropped.
      const slug = slugValue(f['idd-to']);
      const details = await ctx.client.flipbookDetails(id);
      const baseTags = fields.tags === undefined ? (details.tags ?? '') : mergeTags(details.tags ?? '', fields.tags);
      fields.tags = mergeTags(baseTags, [`link:${slug}`], { replaceFacets: ['link'] });
      fields.private_note = mergeNote(fields.private_note === undefined ? (details.private ?? '') : fields.private_note, { idd_to: slug });
    }
    if (!Object.keys(fields).length) throw new HeyzineError('usage', 'No design fields given');
    if (fields.private_note !== undefined) assertNote(fields.private_note);
    return ctx.client.updateDesign(id, fields);
  } },
  social: { usage: 'social <id> [--title T] [--description D] [--thumbnail URL]', needsKey: true, run: async (ctx, p, f) => ctx.client.setSocial(await resolveId(ctx, requireArg(p, 0, 'flipbook id'), 'flipbook'), compact({ title: f.title, description: f.description, thumbnail: f.thumbnail })) },
  'replace-pdf': { usage: 'replace-pdf <id> <url>', needsKey: true, run: async (ctx, p) => ctx.client.replacePdf(await resolveId(ctx, requireArg(p, 0, 'flipbook id'), 'flipbook'), requireArg(p, 1, 'replacement document URL')) },
  delete: { usage: 'delete <id> --confirm "<exact current title>"', needsKey: true, run: async (ctx, p, f) => {
    const id = await resolveId(ctx, requireArg(p, 0, 'flipbook id'), 'flipbook');
    const d = await ctx.client.flipbookDetails(id);
    if (!f.confirm || f.confirm !== d.title) throw new HeyzineError('refused', `Refusing to delete ${id}. Deletion is permanent. Re-run with --confirm "${d.title}" (the exact current title) if you really mean it; archive over delete is the house rule.`);
    return ctx.client.deleteFlipbook(id);
  } },
  shelves: { usage: 'shelves', needsKey: true, run: async (ctx) => ctx.client.listBookshelves() },
  shelf: { usage: 'shelf <id|url>', needsKey: true, run: async (ctx, p) => (await ctx.client.bookshelfFlipbooks(await resolveId(ctx, requireArg(p, 0, 'bookshelf id'), 'bookshelf'))).map((i) => withPublic(i, ctx.settings.publicHost)) },
  'shelf-add': { usage: 'shelf-add <shelf> <flipbook> [--position N]', needsKey: true, run: async (ctx, p, f) => {
    // The position is checked before any lookup, so a typo costs nothing and adds nothing.
    const position = f.position === undefined ? undefined : requireNumber(f.position, '--position');
    const shelf = await resolveId(ctx, requireArg(p, 0, 'bookshelf id'), 'bookshelf');
    const flipbook = await resolveId(ctx, requireArg(p, 1, 'flipbook id'), 'flipbook');
    return ctx.client.addToBookshelf(shelf, flipbook, position);
  } },
  'shelf-remove': { usage: 'shelf-remove <shelf> <flipbook>', needsKey: true, run: async (ctx, p) => ctx.client.removeFromBookshelf(await resolveId(ctx, requireArg(p, 0, 'bookshelf id'), 'bookshelf'), await resolveId(ctx, requireArg(p, 1, 'flipbook id'), 'flipbook')) },
  'shelf-social': { usage: 'shelf-social <shelf> [--title T] [--description D] [--thumbnail URL]', needsKey: true, run: async (ctx, p, f) => ctx.client.setBookshelfSocial(await resolveId(ctx, requireArg(p, 0, 'bookshelf id'), 'bookshelf'), compact({ title: f.title, description: f.description, thumbnail: f.thumbnail })) },
  'access-setup': { usage: 'access-setup <id> --mode disabled|everyone|users [--type flipbook|bookshelf] [--password P | --password-stdin] [--text-user T] [--text-password T]', needsKey: true, run: async (ctx, p, f) => {
    if (!f.mode) throw new HeyzineError('usage', '--mode is required (disabled, everyone, users)');
    const password = await passwordOf(ctx, f);
    const id = await resolveId(ctx, requireArg(p, 0, 'flipbook or bookshelf id'), f.type === 'bookshelf' ? 'bookshelf' : undefined);
    return ctx.client.accessSetup(compact({ id, type: f.type, mode: f.mode, password, text_user: f['text-user'], text_password: f['text-password'] }));
  } },
  'access-add': { usage: 'access-add <id> --access-type T [--user U] [--password P | --password-stdin] [--type flipbook|bookshelf]', needsKey: true, run: async (ctx, p, f) => {
    if (!f['access-type']) throw new HeyzineError('usage', '--access-type is required');
    const password = await passwordOf(ctx, f);
    const id = await resolveId(ctx, requireArg(p, 0, 'flipbook or bookshelf id'), f.type === 'bookshelf' ? 'bookshelf' : undefined);
    return ctx.client.accessAdd(compact({ id, access_type: f['access-type'], user: f.user, password, type: f.type }));
  } },
  'access-remove': { usage: 'access-remove <id> [--user U] [--password P | --password-stdin] [--type flipbook|bookshelf]', needsKey: true, run: async (ctx, p, f) => {
    const password = await passwordOf(ctx, f);
    const id = await resolveId(ctx, requireArg(p, 0, 'flipbook or bookshelf id'), f.type === 'bookshelf' ? 'bookshelf' : undefined);
    return ctx.client.accessRemove(compact({ id, user: f.user, password, type: f.type }));
  } },
  search: { usage: 'search <query>', needsKey: true, run: async (ctx, p) => ctx.client.searchText(requireArg(p, 0, 'query')) },
  'page-text': { usage: 'page-text <id> <page>', needsKey: true, run: async (ctx, p) => {
    const page = requireNumber(requireArg(p, 1, 'page number'), '<page>');
    return ctx.client.pageText(await resolveId(ctx, requireArg(p, 0, 'flipbook id'), 'flipbook'), page);
  } },
  oembed: { usage: 'oembed <flipbook url> [--maxwidth N] [--maxheight N]', needsKey: true, run: async (ctx, p, f) => {
    const maxwidth = f.maxwidth === undefined ? undefined : requireNumber(f.maxwidth, '--maxwidth');
    const maxheight = f.maxheight === undefined ? undefined : requireNumber(f.maxheight, '--maxheight');
    return ctx.client.oembed(requireArg(p, 0, 'flipbook URL'), { maxwidth, maxheight });
  } },
  'link-url': { usage: 'link-url <pdf url> [design flags]', needsKey: false, run: async (ctx, p, f) => ({ url: linkConversionUrl(requireArg(p, 0, 'document URL'), ctx.settings.clientId, designFields(f)) }) },
  'drive-url': { usage: 'drive-url <drive file id or link> [--form usercontent|uc]', needsKey: false, run: async (ctx, p, f) => ({ url: driveDirectUrl(requireArg(p, 0, 'Drive file id or link'), { form: f.form || 'usercontent' }) }) },
  mcp: { usage: "mcp <tool name> [--args '{json}']", needsKey: true, run: async (ctx, p, f) => ctx.client.mcpCall(requireArg(p, 0, 'tool name'), parseArgsJson(f.args)) },
  inventory: { usage: 'inventory [--refresh]', needsKey: true, run: async (ctx, p, f) => {
    let cache = f.refresh ? null : await readInventory(ctx);
    if (!cache) {
      await ctx.mkdir(ctx.dataDir, { recursive: true });
      cache = await refreshInventory(ctx.client, { writeFile: (text) => ctx.writeFile(inventoryPath(ctx.dataDir), text), onProgress: (i, n) => { if (i === n || i % 10 === 0) ctx.stderr.write(`heyzine: inventory ${i}/${n}\n`); } });
    }
    return { fetched_at: cache.fetched_at, count: cache.count, bookshelves: cache.bookshelves.length, bookshelves_error: cache.bookshelves_error, path: inventoryPath(ctx.dataDir), items: cache.items.map((i) => ({ id: i.id, short: shortId(i.id), title: i.title, pages: i.pages, date: i.date, tags: i.tags, public_url: publicUrl(i, ctx.settings.publicHost), register: i.register.fields })) };
  } },
  reconcile: { usage: 'reconcile <names file> [--csv]', needsKey: true, run: async (ctx, p, f) => {
    const cache = await readInventory(ctx);
    if (!cache) throw new HeyzineError('usage', 'No inventory cache yet - run: heyzine inventory --refresh');
    const names = parseNamesFile(await ctx.readFile(requireArg(p, 0, 'names file'), 'utf8'));
    const rows = reconcile(names, cache, { publicHost: ctx.settings.publicHost });
    if (!f.csv) return rows;
    return toCsv(rows.map((r) => ({ ...r, candidates: (r.candidates ?? []).map((c) => `${c.short} ${c.title} (${c.tier})`).join('; ') })), RECONCILE_COLUMNS);
  } },
  batch: { usage: 'batch <csv> [--yes] [--out path] [--concurrency N] [--skip-verify]', needsKey: true, run: async (ctx, p, f) => {
    const file = requireArg(p, 0, 'batch csv');
    const rows = parseCsv(await ctx.readFile(file, 'utf8'));
    if (!rows.length) throw new HeyzineError('usage', `${file} has no rows`);
    if (rows.length > BATCH_REVIEW_THRESHOLD && !f.yes) throw new HeyzineError('refused', `${rows.length} rows is more than ${BATCH_REVIEW_THRESHOLD}; present a scope review (names, sources, purposes) and re-run with --yes once approved`);
    const cache = await readInventory(ctx);
    const skipVerify = Boolean(f['skip-verify']);
    const { results, summary } = await runBatch(ctx, rows, {
      concurrency: f.concurrency === undefined ? 2 : requireNumber(f.concurrency, '--concurrency'),
      cache,
      // The preflight sits inside the row wrapper so an unreadable source fails that one row
      // as failed rather than aborting the whole batch.
      publish: async (rowCtx, spec) => { await preflightSource(rowCtx, spec.source); return publishOne(rowCtx, { ...spec, skipVerify }); },
      onRow: (r) => ctx.stderr.write(`heyzine: row ${r.row} ${r.status} ${r.name}${r.error ? ` (${r.error})` : ''}\n`),
    });
    const outPath = f.out || `${file.replace(/\.csv$/i, '')}.results.csv`;
    await ctx.writeFile(outPath, resultsCsv(results));
    return { results_path: outPath, summary, results };
  } },
};

function parseArgsJson(text) {
  if (!text) return {};
  try { return JSON.parse(text); } catch (error) { throw new HeyzineError('usage', `--args is not valid JSON (${error.message})`); }
}

function compact(obj) { return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== '')); }

function helpText() {
  const lines = ['heyzine - Heyzine flipbook CLI', '', 'Usage: heyzine <command> [options] [--json]', '', 'Commands:'];
  for (const c of Object.values(COMMANDS)) lines.push(`  ${c.usage}`);
  lines.push('', 'Design flags: --title --subtitle --description --private-note --tags --template --download --full-screen --share --prev-next --show-info --background-color --logo --page-effect --rtl --url-path --url-domain (booleans take true or false)', 'Ids accept a full id, the 10 character short id, or the public URL.', 'Exit codes: 0 ok, 1 API or conversion error, 2 configuration or usage error, 3 refused.');
  return lines.join('\n');
}

function render(result, flags) {
  if (flags.json) return `${JSON.stringify(result, null, 2)}\n`;
  if (typeof result === 'string') return result.endsWith('\n') ? result : `${result}\n`;
  if (Array.isArray(result)) {
    if (!result.length) return '(empty)\n';
    return `${result.map((r) => (r && typeof r === 'object'
      ? [r.short ?? shortId(r.id) ?? '', r.status ?? '', r.pages !== undefined ? `${r.pages}p` : '', r.title ?? r.name ?? '', r.public_url ?? r.url ?? r.links?.base ?? ''].filter((x) => x !== '').join('  ')
      : String(r))).join('\n')}\n`;
  }
  if (result && typeof result === 'object') return `${Object.entries(result).map(([k, v]) => `${k}: ${typeof v === 'object' && v !== null ? JSON.stringify(v) : v}`).join('\n')}\n`;
  return `${String(result)}\n`;
}

export async function main(argv, deps = {}) {
  const {
    env = process.env, stdout = process.stdout, stderr = process.stderr, stdin = process.stdin, fetch = globalThis.fetch,
    readFile = fsReadFile, writeFile = fsWriteFile, mkdir = fsMkdir, homedir = os.homedir,
    resolveKey = defaultResolveKey, resolveSettings = defaultResolveSettings,
    makeClient = (key) => new HeyzineClient({ key, fetch }), today = () => new Date().toISOString().slice(0, 10), sleep, now = Date.now,
  } = deps;
  let flags; let positionals;
  try { ({ flags, positionals } = parse(argv)); } catch (error) { stderr.write(`heyzine: ${error.message}\n`); return 2; }
  const name = positionals[0] ?? 'help';
  const command = COMMANDS[name];
  if (!command || flags.help) {
    if (!command) stderr.write(`heyzine: unknown command "${name}"\n`);
    stdout.write(render(helpText(), {}));
    return command ? 0 : 2;
  }
  try {
    const warn = (m) => stderr.write(`heyzine: ${m}\n`);
    const settings = await resolveSettings({ env, homedir, readFile, warn });
    const ctx = { settings, dataDir: dataDir({ env, homedir }), stdout, stderr, stdin, fetch, readFile, writeFile, mkdir, today, sleep, pollOptions: { sleep, now } };
    if (command.needsKey) {
      const { key, source, configPath } = await resolveKey({ env, homedir, readFile, warn });
      if (!key) { stderr.write(`heyzine: no API key configured. Run /heyzine:setup, or create ${configPath ?? settings.configPath} with api_key = "..." and client_id = "..." (chmod 600).\n`); return 2; }
      ctx.keySource = source;
      ctx.client = makeClient(key);
    }
    const result = await command.run(ctx, positionals.slice(1), flags);
    stdout.write(render(result, flags));
    return 0;
  } catch (error) {
    const code = error?.code ?? 'error';
    stderr.write(`heyzine: ${code}: ${error.message}\n`);
    if (error instanceof ConfigError || code === 'config' || code === 'usage') return 2;
    if (code === 'refused') return 3;
    return 1;
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });

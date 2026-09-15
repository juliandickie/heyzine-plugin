import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  ConfigError, present, parseToml, configPath, readConfigFile, findOp, readOpRef,
  resolveKey, resolveSettings, dataDir, OP_TIMEOUT_MS, makeExecOp, opChildEnv, OP_SECRET_ENV,
} from '../lib/config.mjs';

const home = () => '/home/tester';
const fileAt = (contents, mode = 0o600) => ({
  readFile: async (p) => { if (p in contents) return contents[p]; const e = new Error('nope'); e.code = 'ENOENT'; throw e; },
  stat: async () => ({ mode }),
});
const CFG = '/home/tester/.config/heyzine-plugin/config.toml';

test('present treats empty and user_config placeholders as absent', () => {
  assert.equal(present(undefined), false);
  assert.equal(present('   '), false);
  assert.equal(present('${user_config.heyzine_api_key}'), false);
  assert.equal(present('abc'), true);
});

test('parseToml handles quoted, bare, comments, duplicates, and reports skipped lines', () => {
  const { values, skipped } = parseToml([
    '# comment', 'api_key = "k#1"', 'client_id = d3m0 # trailing', 'bad line here',
    'public_host = "a"', 'public_host = "b"', 'empty = ""', 'unterminated = "x',
  ].join('\n'));
  assert.deepEqual(values, { api_key: 'k#1', client_id: 'd3m0', public_host: 'b', empty: '' });
  assert.deepEqual(skipped.map((s) => s.line), [4, 8]);
});

test('configPath honours XDG_CONFIG_HOME and falls back to ~/.config', () => {
  assert.equal(configPath({ env: {}, homedir: home }), CFG);
  assert.equal(configPath({ env: { XDG_CONFIG_HOME: '/x' }, homedir: home }), path.join('/x', 'heyzine-plugin', 'config.toml'));
});

test('readConfigFile returns exists=false on ENOENT and warns on loose permissions', async () => {
  const missing = await readConfigFile({ env: {}, homedir: home, ...fileAt({}) });
  assert.deepEqual(missing, { path: CFG, values: {}, exists: false });
  const warnings = [];
  const loose = await readConfigFile({ env: {}, homedir: home, ...fileAt({ [CFG]: 'api_key = "k"' }, 0o644), warn: (m) => warnings.push(m) });
  assert.equal(loose.values.api_key, 'k');
  assert.match(warnings[0], /chmod 600/);
});

test('resolveKey order - env wins, then file api_key, then op ref, else none', async () => {
  const envHit = await resolveKey({ env: { HEYZINE_API_KEY: ' e ' }, homedir: home, ...fileAt({ [CFG]: 'api_key = "f"' }) });
  assert.deepEqual(envHit, { key: 'e', source: 'env' });
  const fileHit = await resolveKey({ env: { HEYZINE_API_KEY: '${user_config.heyzine_api_key}' }, homedir: home, ...fileAt({ [CFG]: 'api_key = "f"\nop_ref = "op://V/I/f"' }) });
  assert.deepEqual(fileHit, { key: 'f', source: 'file' });
  const calls = [];
  const opHit = await resolveKey({
    env: { HEYZINE_OP_ACCOUNT: 'team.1password.com' }, homedir: home, ...fileAt({ [CFG]: 'op_ref = "op://Employee/API Heyzine/credential"' }),
    findOp: () => '/opt/homebrew/bin/op', execOp: async (bin, args) => { calls.push([bin, args]); return 'from-op\n'; },
  });
  assert.deepEqual(opHit, { key: 'from-op', source: 'op' });
  assert.deepEqual(calls[0], ['/opt/homebrew/bin/op', ['read', '--account', 'team.1password.com', '--', 'op://Employee/API Heyzine/credential']]);
  const none = await resolveKey({ env: {}, homedir: home, ...fileAt({}) });
  assert.deepEqual(none, { key: null, source: 'none', configPath: CFG });
});

test('resolveKey reads the plugin option env var when HEYZINE_API_KEY is absent', async () => {
  const hit = await resolveKey({ env: { CLAUDE_PLUGIN_OPTION_HEYZINE_API_KEY: 'opt' }, homedir: home, ...fileAt({}) });
  assert.deepEqual(hit, { key: 'opt', source: 'env' });
});

test('a configured but broken op step fails loud instead of falling through', async () => {
  await assert.rejects(
    resolveKey({ env: { HEYZINE_KEY_OP_REF: 'not-a-ref' }, homedir: home, ...fileAt({}) }),
    (e) => e instanceof ConfigError && /op:\/\/Vault\/Item\/field/.test(e.message),
  );
  await assert.rejects(
    readOpRef('op://V/I/f', { findOp: () => null }),
    (e) => e instanceof ConfigError && /op\) not found/.test(e.message),
  );
  await assert.rejects(
    readOpRef('op://V/I/f', { findOp: () => '/bin/op', execOp: async () => { throw new Error(`op timed out after ${OP_TIMEOUT_MS} ms`); } }),
    (e) => e instanceof ConfigError && /timed out/.test(e.message),
  );
  await assert.rejects(
    readOpRef('op://V/I/f', { findOp: () => '/bin/op', execOp: async () => '' }),
    (e) => e instanceof ConfigError && /empty value/.test(e.message),
  );
});

test('findOp searches PATH then the Homebrew and /usr/local locations', () => {
  const exists = (p) => p === '/opt/homebrew/bin/op';
  assert.equal(findOp({ env: { PATH: '/usr/bin:/bin' }, exists }), '/opt/homebrew/bin/op');
  assert.equal(findOp({ env: { PATH: '' }, exists: () => false }), null);
});

test('resolveSettings prefers env, then plugin option env, then file, and blanks the rest', async () => {
  const s = await resolveSettings({
    env: { HEYZINE_PUBLIC_HOST: 'docs.aflip.in', CLAUDE_PLUGIN_OPTION_TEMPLATE_ID: 'tpl-from-option' },
    homedir: home, ...fileAt({ [CFG]: 'client_id = "cid"\npublic_host = "file-host"\ndefault_tags = "published-by:heyzine-plugin"' }),
  });
  assert.equal(s.configPath, CFG);
  assert.equal(s.configExists, true);
  assert.equal(s.clientId, 'cid');
  assert.equal(s.publicHost, 'docs.aflip.in');
  assert.equal(s.templateId, 'tpl-from-option');
  assert.equal(s.urlDomain, '');
  assert.equal(s.stagingFolderId, '');
  assert.equal(s.defaultTags, 'published-by:heyzine-plugin');
});

test('dataDir prefers HEYZINE_PLUGIN_DATA, then CLAUDE_PLUGIN_DATA, then the default', () => {
  assert.equal(dataDir({ env: { HEYZINE_PLUGIN_DATA: '/d1', CLAUDE_PLUGIN_DATA: '/d2' } }), '/d1');
  assert.equal(dataDir({ env: { CLAUDE_PLUGIN_DATA: '/d2' } }), '/d2');
  assert.equal(dataDir({ env: {}, homedir: home }), '/home/tester/.claude/plugins/data/heyzine');
});

test('the op child process inherits no key and no pointer to one', async () => {
  const seen = [];
  const env = {
    PATH: '/usr/bin', HOME: '/home/tester',
    HEYZINE_API_KEY: 'SECRET', HEYZINE_KEY_OP_REF: 'op://V/I/f', HEYZINE_OP_ACCOUNT: 'team.1password.com',
    CLAUDE_PLUGIN_OPTION_HEYZINE_API_KEY: 'SECRET', CLAUDE_PLUGIN_OPTION_HEYZINE_KEY_OP_REF: 'op://V/I/f',
    CLAUDE_PLUGIN_OPTION_HEYZINE_OP_ACCOUNT: 'team.1password.com',
  };
  const execFileImpl = (bin, args, options, cb) => { seen.push({ bin, args, options }); cb(null, 'from-op\n', ''); };
  const execOp = makeExecOp({ execFileImpl, env });
  assert.equal(await execOp('/bin/op', ['read', '--', 'op://V/I/f']), 'from-op');
  const childEnv = seen[0].options.env;
  for (const name of OP_SECRET_ENV) assert.equal(name in childEnv, false, `${name} should not reach op`);
  assert.equal(childEnv.PATH, '/usr/bin');
  assert.equal(childEnv.HOME, '/home/tester');
  assert.equal(env.HEYZINE_API_KEY, 'SECRET', 'the caller env must not be mutated');
  assert.equal(seen[0].options.timeout, OP_TIMEOUT_MS);
  const fromProcess = makeExecOp({ execFileImpl });
  await fromProcess('/bin/op', ['read']);
  assert.equal(seen[1].options.env.PATH, process.env.PATH, 'the default env is this process own');
  for (const name of OP_SECRET_ENV) assert.equal(name in seen[1].options.env, false);
  assert.equal('HEYZINE_API_KEY' in opChildEnv({ HEYZINE_API_KEY: 'x', PATH: '/p' }), false);
});

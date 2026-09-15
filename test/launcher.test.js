import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { main, proxyPath, buildArgv, MCP_URL, HEADER_FILE_NAME } from '../scripts/run-mcp.mjs';

function fakeSpawn(exitCode = 0) {
  const spawned = [];
  const spawnImpl = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.kill = () => {};
    spawned.push({ cmd, args, opts, child });
    setImmediate(() => child.emit('exit', exitCode));
    return child;
  };
  return { spawnImpl, spawned };
}

const base = (over = {}) => {
  const writes = []; const chmods = []; const errs = [];
  const { spawnImpl, spawned } = fakeSpawn();
  return {
    deps: {
      env: { HEYZINE_PLUGIN_DATA: '/data', CLAUDE_PLUGIN_ROOT: '/root' },
      resolve: async () => ({ key: 'SECRET', source: 'file' }),
      write: async (p, text, opts) => { writes.push({ p, text, opts }); },
      mkdirp: async () => {}, chmodImpl: async (p, mode) => { chmods.push({ p, mode }); },
      exists: () => true, spawnImpl, stderr: { write: (s) => errs.push(s) }, execPath: '/usr/bin/node', onSignal: () => {},
      ...over,
    },
    writes, chmods, errs, spawned,
  };
};

test('proxyPath and buildArgv', () => {
  assert.equal(proxyPath('/data'), '/data/node_modules/mcp-remote/dist/proxy.js');
  assert.equal(MCP_URL, 'https://heyzine.com/mcp');
  assert.deepEqual(buildArgv({ proxy: '/p.js', headerFile: '/data/h' }), ['/p.js', 'https://heyzine.com/mcp', '--transport', 'http-only', '--header-file', '/data/h']);
  assert.deepEqual(buildArgv({ proxy: '/p.js', headerFile: null }), ['/p.js', 'https://heyzine.com/mcp', '--transport', 'http-only']);
});

test('with a key the launcher writes a 0600 header file and never puts the key in argv', async () => {
  const h = base();
  assert.equal(await main(h.deps), 0);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].p, `/data/${HEADER_FILE_NAME}`);
  assert.equal(h.writes[0].text, 'Authorization: Bearer SECRET\n');
  assert.equal(h.writes[0].opts.mode, 0o600);
  assert.deepEqual(h.chmods, [{ p: `/data/${HEADER_FILE_NAME}`, mode: 0o600 }]);
  const { cmd, args, opts } = h.spawned[0];
  assert.equal(cmd, '/usr/bin/node');
  assert.equal(args.join(' ').includes('SECRET'), false);
  assert.ok(args.includes('--header-file'));
  assert.equal(opts.stdio, 'inherit');
  assert.equal(h.errs.join('').includes('SECRET'), false);
});

test('without a key the launcher starts mcp-remote in OAuth mode and says so', async () => {
  const h = base({ resolve: async () => ({ key: null, source: 'none', configPath: '/cfg' }) });
  assert.equal(await main(h.deps), 0);
  assert.equal(h.writes.length, 0);
  assert.equal(h.spawned[0].args.includes('--header-file'), false);
  assert.match(h.errs.join(''), /OAuth/);
});

test('a configuration error exits 2 with the message', async () => {
  const { ConfigError } = await import('../lib/config.mjs');
  const h = base({ resolve: async () => { throw new ConfigError('op read failed: timed out'); } });
  assert.equal(await main(h.deps), 2);
  assert.match(h.errs.join(''), /op read failed/);
  assert.equal(h.spawned.length, 0);
});

test('missing mcp-remote exits 2 with the install hint', async () => {
  const h = base({ exists: () => false });
  assert.equal(await main(h.deps), 2);
  assert.match(h.errs.join(''), /install-deps\.sh/);
});

test('the child exit code is forwarded', async () => {
  const { spawnImpl } = fakeSpawn(7);
  const h = base({ spawnImpl });
  assert.equal(await main(h.deps), 7);
});

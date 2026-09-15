#!/usr/bin/env node
// Launcher for the Heyzine MCP bridge. Resolves the API key through the shared chain,
// writes it to a 0600 header file in the plugin data dir, and execs mcp-remote against
// https://heyzine.com/mcp. The key never appears in argv. With no key configured it lets
// mcp-remote run Heyzine's OAuth sign-in instead.
// The header file is short lived - it is removed before it is rewritten and again when the
// child exits, so it exists only for the life of one mcp-remote process. It holds a live
// credential in plain text and must never be copied, backed up, committed or otherwise
// moved out of the plugin data dir. The key is also stripped from the child's environment.
import { writeFile, mkdir, chmod, rm } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveKey, dataDir, ConfigError } from '../lib/config.mjs';

export const MCP_URL = 'https://heyzine.com/mcp';
export const HEADER_FILE_NAME = 'mcp-remote.headers';

// Variables that can carry the key or a pointer to it. The child reads its credential from
// the header file, so none of these have any business in its environment.
export const SECRET_ENV = [
  'HEYZINE_API_KEY', 'HEYZINE_KEY_OP_REF', 'HEYZINE_OP_ACCOUNT',
  'CLAUDE_PLUGIN_OPTION_HEYZINE_API_KEY', 'CLAUDE_PLUGIN_OPTION_HEYZINE_KEY_OP_REF', 'CLAUDE_PLUGIN_OPTION_HEYZINE_OP_ACCOUNT',
];

export function proxyPath(dir) { return path.join(dir, 'node_modules', 'mcp-remote', 'dist', 'proxy.js'); }

export function buildArgv({ proxy, headerFile }) {
  const args = [proxy, MCP_URL, '--transport', 'http-only'];
  if (headerFile) args.push('--header-file', headerFile);
  return args;
}

export function childEnv(env) {
  const out = { ...env };
  for (const name of SECRET_ENV) delete out[name];
  return out;
}

export async function main({
  env = process.env, resolve = resolveKey, write = writeFile, mkdirp = mkdir, chmodImpl = chmod, rmImpl = rm, exists = existsSync,
  spawnImpl = spawn, stderr = process.stderr, execPath = process.execPath,
  onSignal = (handler) => { for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => handler(sig)); },
} = {}) {
  const dir = dataDir({ env });
  const proxy = proxyPath(dir);
  if (!exists(proxy)) {
    stderr.write(`heyzine: mcp-remote is not installed in ${dir}. Open a new session (the SessionStart hook installs it) or run: "${env.CLAUDE_PLUGIN_ROOT ?? '<plugin root>'}/scripts/install-deps.sh"\n`);
    return 2;
  }
  let key = null;
  try {
    ({ key } = await resolve({ env, warn: (m) => stderr.write(`heyzine: ${m}\n`) }));
  } catch (error) {
    if (error instanceof ConfigError || error?.code === 'config') { stderr.write(`heyzine: ${error.message}\n`); return 2; }
    throw error;
  }
  if (key && /[\r\n]/.test(key)) {
    stderr.write('heyzine: API key must be a single line\n');
    return 2;
  }
  const staleFile = path.join(dir, HEADER_FILE_NAME);
  let headerFile = null;
  if (key) {
    headerFile = staleFile;
    await mkdirp(dir, { recursive: true });
    await rmImpl(headerFile, { force: true });
    await write(headerFile, `Authorization: Bearer ${key}\n`, { mode: 0o600, flag: 'wx' });
    await chmodImpl(headerFile, 0o600);
  } else {
    // A header file left by an earlier run would still hold a live key, and mcp-remote is
    // about to run OAuth instead, so nothing will overwrite it. Clear it now.
    await rmImpl(staleFile, { force: true });
    stderr.write('heyzine: no API key configured - starting mcp-remote in OAuth mode (a browser sign-in opens). Run /heyzine:setup to store a key for unattended use.\n');
  }
  const child = spawnImpl(execPath, buildArgv({ proxy, headerFile }), { stdio: 'inherit', env: childEnv(env) });
  onSignal((sig) => { try { child.kill(sig); } catch { /* already gone */ } });
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned || !headerFile) return;
    cleaned = true;
    try { await rmImpl(headerFile, { force: true }); } catch { /* best effort - the key file may already be gone */ }
  };
  return new Promise((done) => {
    child.on('exit', (code) => { cleanup().then(() => done(code ?? 1)); });
    child.on('error', (error) => {
      stderr.write(`heyzine: failed to start mcp-remote: ${error.message}\n`);
      cleanup().then(() => done(2));
    });
  });
}

function invokedDirectly() {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (invokedDirectly()) {
  main()
    .then((code) => { process.exitCode = code; })
    .catch((error) => { process.stderr.write(`heyzine: ${error.message}\n`); process.exitCode = 1; });
}

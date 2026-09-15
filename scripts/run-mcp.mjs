#!/usr/bin/env node
// Launcher for the Heyzine MCP bridge. Resolves the API key through the shared chain,
// writes it to a 0600 header file in the plugin data dir, and execs mcp-remote against
// https://heyzine.com/mcp. The key never appears in argv. With no key configured it lets
// mcp-remote run Heyzine's OAuth sign-in instead.
import { writeFile, mkdir, chmod } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveKey, dataDir, ConfigError } from '../lib/config.mjs';

export const MCP_URL = 'https://heyzine.com/mcp';
export const HEADER_FILE_NAME = 'mcp-remote.headers';

export function proxyPath(dir) { return path.join(dir, 'node_modules', 'mcp-remote', 'dist', 'proxy.js'); }

export function buildArgv({ proxy, headerFile }) {
  const args = [proxy, MCP_URL, '--transport', 'http-only'];
  if (headerFile) args.push('--header-file', headerFile);
  return args;
}

export async function main({
  env = process.env, resolve = resolveKey, write = writeFile, mkdirp = mkdir, chmodImpl = chmod, exists = existsSync,
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
  let headerFile = null;
  if (key) {
    headerFile = path.join(dir, HEADER_FILE_NAME);
    await mkdirp(dir, { recursive: true });
    await write(headerFile, `Authorization: Bearer ${key}\n`, { mode: 0o600 });
    await chmodImpl(headerFile, 0o600);
  } else {
    stderr.write('heyzine: no API key configured - starting mcp-remote in OAuth mode (a browser sign-in opens). Run /heyzine:setup to store a key for unattended use.\n');
  }
  const child = spawnImpl(execPath, buildArgv({ proxy, headerFile }), { stdio: 'inherit', env });
  onSignal((sig) => { try { child.kill(sig); } catch { /* already gone */ } });
  return new Promise((done) => {
    child.on('exit', (code) => done(code ?? 1));
    child.on('error', (error) => { stderr.write(`heyzine: failed to start mcp-remote: ${error.message}\n`); done(2); });
  });
}

function invokedDirectly() {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (invokedDirectly()) main().then((code) => process.exit(code));

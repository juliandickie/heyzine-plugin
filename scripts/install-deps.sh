#!/usr/bin/env bash
# SessionStart hook - installs mcp-remote into the persistent plugin data dir (never the
# plugin root, which is replaced on update). Quiet and idempotent - prints one line only
# when it installs, and never fails the session start.
set -uo pipefail
ROOT="${CLAUDE_PLUGIN_ROOT:-}"
if [ -z "$ROOT" ]; then echo "heyzine: CLAUDE_PLUGIN_ROOT is not set; skipping dependency check" >&2; exit 0; fi
DATA="${CLAUDE_PLUGIN_DATA:-$HOME/.claude/plugins/data/heyzine}"
WANT="$(ROOT="$ROOT" node -p "require(process.env.ROOT + '/package.json').heyzinePlugin.mcpRemoteVersion" 2>/dev/null || echo "")"
if [ -z "$WANT" ]; then echo "heyzine: could not read the pinned mcp-remote version from package.json" >&2; exit 0; fi
HAVE=""
if [ -f "$DATA/node_modules/mcp-remote/package.json" ]; then
  HAVE="$(DATA="$DATA" node -p "require(process.env.DATA + '/node_modules/mcp-remote/package.json').version" 2>/dev/null || echo "")"
fi
if [ "$HAVE" = "$WANT" ]; then exit 0; fi
mkdir -p "$DATA"
if [ ! -f "$DATA/package.json" ]; then printf '{ "name": "heyzine-plugin-data", "private": true }\n' > "$DATA/package.json"; fi
if npm install --prefix "$DATA" --no-audit --no-fund --no-package-lock --loglevel=error "mcp-remote@$WANT" >/dev/null 2>"$DATA/install.log"; then
  echo "heyzine: installed mcp-remote $WANT into the plugin data dir"
else
  echo "heyzine: mcp-remote install failed (see $DATA/install.log); the Heyzine MCP bridge is unavailable this session, the heyzine CLI still works" >&2
fi
exit 0

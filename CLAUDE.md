# Heyzine Plugin - AI Agent Context File

## What This Plugin Does

Publishes PDFs (and Word, PowerPoint, OpenDocument, RTF) as Heyzine flipbooks and
carries them to where they are used - lead magnets, LearnDash
course material, website embeds, bookshelves, access lists. Two ways in share
one key resolver - the `heyzine` CLI (REST, JSON, unattended, primary path for
skills) and an MCP bridge (mcp-remote against https://heyzine.com/mcp, the
conversational path). The register of what was published lives inside Heyzine
as tags and a private note. Sibling plugins (Scribe for Drive, Short.io tools
for short links, wp-manager and the academy tooling for LearnDash) are composed by
capability reference in skill prose, never by importing their tools.

## Repo Layout Rules

Seven dirs at the plugin root - lib/ (the modules), bin/ (the `heyzine` entry
point), scripts/ (run-mcp.mjs and install-deps.sh), hooks/ (hooks.json), skills/
(the ten skills), test/ (one file per lib module plus the launcher contract),
dev-docs/ (tracked, dated, additive logs - API audits, smoke records, the
release checklist). .claude-plugin holds only plugin.json and marketplace.json.
Use ${CLAUDE_PLUGIN_ROOT} for bundled paths and ${CLAUDE_PLUGIN_DATA} for
anything written at runtime (mcp-remote, the header file, the inventory cache).
docs/ is gitignored and local-only (spec, plan, probe artifacts).

## Build and Test

ESM, Node 24, built-ins only. `npm test` runs `node --test test/*.test.js`
(the only form that works on Node 24 here); `claude plugin validate .` is the
other gate. Every module in lib/ takes its side effects (fs, exec, fetch, clock)
as injectable parameters and is unit tested without network. The launcher test
asserts the security contract - the key is written to a 0600 header file, never
appears in argv, and is stripped from the child environment.

## Known API Limits (proven live, dev-docs/api-audit-2026-09-15.md)

Private note max 200 characters (over it the async convert silently drops title, tags,
note and template; flipbook-design answers HTTP 500). Details, list and the rendered page
lag `processed` by minutes; read back through `waitForRegister`, never once. Replace is
honoured only by the blocking endpoints. REST errors are HTTP 200 bodies with
`success:false`. HEAD every source for application/pdf; an HTML 404 page still converts.

## Versioning

MAJOR breaking skill or CLI change, MINOR new skill or command, PATCH fix.
Four version copies move together - plugin.json, marketplace.json,
package.json, CHANGELOG.md. See dev-docs/release-checklist.md.

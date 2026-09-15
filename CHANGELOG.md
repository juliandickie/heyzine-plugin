# Changelog

## 0.1.0 - unreleased

Initial build.

- Ten skills - `heyzine` (overview and router), `setup`, `publish`, `lead-magnet`,
  `course-material`, `bookshelf`, `access`, `inventory`, `batch-convert`, and the
  `heyzine-api` reference (loaded automatically, not user invocable).
- A 27 command `heyzine` CLI over the REST API - `help`, `whoami`, `list`, `details`,
  `convert`, `publish`, `design`, `social`, `replace-pdf`, `delete`, `shelves`, `shelf`,
  `shelf-add`, `shelf-remove`, `shelf-social`, `access-setup`, `access-add`,
  `access-remove`, `search`, `page-text`, `oembed`, `link-url`, `drive-url`, `mcp`,
  `inventory`, `reconcile`, `batch`. JSON output on every command, ids accepted as full
  id, short id or public URL, exit codes 0 ok, 1 API or conversion error, 2 configuration
  or usage, 3 refused.
- An MCP bridge to https://heyzine.com/mcp through a pinned `mcp-remote`, installed into
  the plugin data dir by a SessionStart hook. The key is written to a 0600 header file,
  never put in argv, stripped from the child environment, and the file is removed when
  the child exits. With no key configured the bridge runs Heyzine's OAuth sign in.
- Four key methods behind one shared resolver - plugin config field, config file at
  `~/.config/heyzine-plugin/config.toml`, 1Password reference through the `op` CLI, and
  OAuth (MCP only).
- The register - `facet:value` tags (`purpose`, `course`, `link`, `source`,
  `published-by`) and a `key = value` private note (`source_drive_id`, `source_name`,
  `source_url`, `idd_to`, `embedded`, `published`, `published_by`) written on every
  publish, so the Heyzine account is the inventory. Hand written note lines survive;
  facet shaped tags and `key = value` lines passed in by hand are stripped.
- Three MCP tools surfaced that the public developers page does not document -
  `heyzine_replace_flipbook_pdf`, `heyzine_search_text` and `heyzine_page_text`. The last
  two back the CLI's `search` and `page-text` commands, which have no REST equivalent.
- The replace path, proven live on 2026-09-15 - `replace: true` is honoured only by the
  blocking endpoints, so `--replace` runs on REST `/rest` and ignores `--wait`. The id,
  both public URLs, the title, the tags and the private note survive a replace. Recorded
  in `dev-docs/api-audit-2026-09-15.md` and `dev-docs/smoke-run-2026-09-15.md`.

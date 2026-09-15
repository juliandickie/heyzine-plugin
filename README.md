# heyzine

A Claude Code plugin for [Heyzine](https://heyzine.com). It turns PDFs (and Word,
PowerPoint, OpenDocument and RTF files) into hosted flipbooks, then carries each one the
rest of the way to wherever it is actually used. Publishing is the easy half. The work
the plugin takes off your hands is everything after it - staging the source on Google
Drive so Heyzine can fetch it, applying a house template and sensible per-purpose
defaults, writing a social card, recording what was published and why, verifying both
public URLs by fetching them, and handing the result to a lead magnet page, a LearnDash
lesson, a bookshelf or an access list.

The inventory of what exists lives inside Heyzine itself, not in a file beside the
plugin. Every flipbook the plugin makes carries `facet:value` tags and a `key = value`
private note, so the account stays the single source of truth and any session can read
back the purpose, the course, the short link and the Drive source of any flipbook. There
are two ways in, and they share one key resolver - the `heyzine` command line tool
(REST, JSON, unattended, the path every skill names first) and an MCP bridge to Heyzine's
hosted server at https://heyzine.com/mcp for conversational use.

## Status

0.1.3, released 2026-09-15 - private GitHub repo, listed in the outfit and ai-loadout
catalogs, installed as `heyzine@outfit`. First real batch done the same night - 37 academy
review PDFs converted, registered and linked from the short domain (dev-docs/smoke-run-2026-09-15.md).
Latest handoff - dev-docs/SESSION-HANDOFF-2026-09-15-night.md.

## Install

```bash
claude plugin marketplace add juliandickie/heyzine-plugin
claude plugin install heyzine@heyzine-plugin
```

Once the plugin is listed in the outfit and ai-loadout catalogues, installing from either
of those is the same two commands with that marketplace name in place of
`heyzine-plugin`, for example `claude plugin install heyzine@ai-loadout`. One copy is
enough; installing from two marketplaces gives you two copies of the same skills.

A SessionStart hook installs the pinned `mcp-remote` into the plugin data dir on first
run. It prints one line when it installs and is silent afterwards. If that install fails
the MCP bridge is unavailable for the session and the CLI still works.

## Setup

Run `/heyzine:setup` once per machine, and again whenever the key rotates. The API key
and the client id both come from https://heyzine.com/developers#apikey. The key is
secret; the client id is not, and the REST convert endpoints will not work without it.

The CLI and the MCP bridge share one resolver. The first configured method wins, and a
configured method that fails is a loud error rather than a silent fall through to the
next one.

| Method | How it is supplied | When to use it |
|---|---|---|
| Plugin config field | "Heyzine API Key" in `/plugin`, stored in the OS keychain | A single interactive machine |
| Config file | `api_key` in `~/.config/heyzine-plugin/config.toml`, mode 0600 | The unattended default, and the only method that survives a session with nobody present |
| 1Password reference | `op_ref = "op://Vault/Item/field"` in the file, or the "1Password Secret Reference" plugin field, read through the `op` CLI at start | A machine where the key should never be written to disk. Needs 1Password unlocked, and sessions expire after ten minutes |
| OAuth | Nothing configured, so the bridge starts `mcp-remote` in OAuth mode and a browser sign in opens | A personal account with no stored key. The token works on MCP only, so the CLI stays unavailable |

The config file is the recommended method. Create it with `chmod 600`.

```toml
api_key = "..."
client_id = "..."
public_host = "docs.aflip.in"
template_id = ""
url_domain = ""
staging_folder_id = ""
default_tags = "published-by:heyzine-plugin"
```

Then verify.

```bash
heyzine whoami --json
```

It reports the key source, the config path, the flipbook count, whether bookshelf
listing works (a plan probe), whether the client id is configured, the public host, the
template, the staging folder and the data dir. It proves the key works and what the
probes saw. It does not name the plan, and it never prints the key. A missing client id
shows as `client_id_configured: false`, and every conversion will fail with exit code 2
until it is added.

## Skills

| Skill | What it does |
|---|---|
| `heyzine` | Overview and router - which skill to use, the register schema, the link rules, the plan gates, the two ways in |
| `/heyzine:setup` | First run configuration of the key, client id, public host, template and Drive staging folder, then `heyzine whoami` |
| `/heyzine:publish` | One document end to end - stage, convert, template, purpose defaults, social card, register, verify both URLs |
| `/heyzine:lead-magnet` | The share kit for a free download - both URLs, oEmbed iframe, button and anchor snippets, an the short domain short link, the social card |
| `/heyzine:course-material` | A course PDF into LearnDash Materials with a course-prefixed the short domain link and the chapter and lesson snippets |
| `/heyzine:bookshelf` | List, inspect, fill, order and brand bookshelves |
| `/heyzine:access` | Shared password, per-user credentials, Google sign in, one-time codes and email links, bulk grants and revocation |
| `/heyzine:inventory` | Refresh the cache, list by tag or course, search the full text of every flipbook, read one page, reconcile a names list against the account |
| `/heyzine:batch-convert` | Many documents unattended from a CSV, a Sheet or a Drive folder, with bounded concurrency and a results CSV |
| `heyzine-api` | Reference for endpoints, parameters, plan gates, payload shapes and curl examples. Loaded automatically, not user invocable |

## CLI commands

`heyzine` is on the Bash PATH while the plugin is enabled. Every command takes `--json`
for machine readable output. Ids accept a full id, the ten character short id or a
public URL, and are resolved through the inventory cache or a live list.

| Command | What it does |
|---|---|
| `help` | The command list, the design flags and the exit codes |
| `whoami` | Key source, counts, plan probes, configured settings, data dir |
| `list [--limit N] [--offset N]` | The account's flipbooks, newest first, paged |
| `details <id\|short\|url>` | One flipbook with its tags, private note, links and oEmbed, plus the parsed register |
| `convert <url> [--wait] [--replace] [design flags]` | Convert a document URL. `--wait` polls until processed |
| `publish <source> --name <name> [--purpose P] [--course C] [--idd-to slug] [--template id] [--replace] [--note text] [--description text] [--embedded list] [--skip-verify] [design flags]` | The whole flow - preflight, convert, template, purpose defaults, social card, register, details, live GET of both URLs |
| `design <id> [--idd-to slug] [design flags]` | Change only the design fields supplied. `--idd-to` records a short link, replacing the `link:` tag and setting `idd_to` in the note |
| `social <id> [--title T] [--description D] [--thumbnail URL]` | The Open Graph card |
| `replace-pdf <id> <url>` | The support-gated replace endpoint. Refused unless Heyzine has enabled the account |
| `delete <id> --confirm "<exact current title>"` | Permanent deletion, refused without the exact title |
| `shelves` | List bookshelves (Premium) |
| `shelf <id\|url>` | The flipbooks on one shelf in display order |
| `shelf-add <shelf> <flipbook> [--position N]` | Add at a position, or append |
| `shelf-remove <shelf> <flipbook>` | Remove from the shelf, leaving the flipbook alone |
| `shelf-social <shelf> [--title T] [--description D] [--thumbnail URL]` | The shelf's Open Graph card |
| `access-setup <id> --mode disabled\|everyone\|users [--type flipbook\|bookshelf] [--password P \| --password-stdin] [--text-user T] [--text-password T]` | Turn access control on or off and set the prompt text |
| `access-add <id> --access-type T [--user U] [--password P \| --password-stdin] [--type flipbook\|bookshelf]` | Grant one entry (user_pass, google, pass_only, otp, email_link, email_code, send_code) |
| `access-remove <id> [--user U] [--password P \| --password-stdin] [--type flipbook\|bookshelf]` | Revoke one entry |
| `search <query>` | Full text search across every flipbook in the account |
| `page-text <id> <page>` | The extracted text of one page |
| `oembed <flipbook url> [--maxwidth N] [--maxheight N]` | The embeddable iframe html |
| `link-url <pdf url> [design flags]` | Build a keyless link conversion URL that converts on first visit |
| `drive-url <drive file id or link> [--form usercontent\|uc]` | Build the Drive direct download URL Heyzine can fetch |
| `mcp <tool name> [--args '{json}']` | Call any Heyzine MCP tool by name |
| `inventory [--refresh]` | Read or rebuild the local inventory cache of every flipbook with its register |
| `reconcile <names file> [--csv]` | Match a list of resource names against the account. `--csv` writes name, status, id, short, title, url, idd_to, candidates |
| `batch <csv> [--yes] [--out path] [--concurrency N] [--skip-verify]` | Publish many rows unattended. `--out` chooses where the results CSV lands (default is the input name with `.results.csv`) |

Design flags on `convert`, `publish`, `design` and `link-url` - `--title --subtitle
--description --private-note --tags --template --download --full-screen --share
--prev-next --show-info --background-color --logo --page-effect --rtl --url-path
--url-domain`. Booleans take `true` or `false`. Page effects are magazine, book, album,
notebook, fade, cards, coverflow and flip (`slideshow` is an alias of fade, `onepage` of
flip).

`--replace` runs on Heyzine's blocking REST endpoint, because that is the only endpoint
that actually stores a new edition under the same id. `convert --replace` therefore
ignores `--wait` and prints a notice on stderr saying the call may take a while for a
large document. The async endpoint accepts the flag, answers `processed` at once and
leaves the old edition in place, which is why the plugin does not use it for replaces.

Every request carries a timeout - 60 seconds, or 15 minutes for the blocking replace
endpoint, which really does take minutes on a large document. A request that runs out of
time fails with the `timeout` code and is never retried, because the server may well be
part way through the work. Transient failures (a network error, a 429, a 5xx) are retried
three times with backoff on GET requests and on the two convert endpoints only; every
other POST or PATCH is attempted exactly once, since retrying a write can publish,
delete, reorder or grant twice.

The three `access-*` commands take `--password-stdin` instead of `--password`, reading
the password as the first line of stdin. A password passed as a flag appears in the
process list and in the session transcript on disk; piped in, it appears in neither.

```bash
printf '%s\n' "$PW" | heyzine access-add <id> --access-type pass_only --password-stdin
```

Numeric flags (`--position`, `--limit`, `--offset`, `--maxwidth`, `--maxheight`,
`--concurrency`, and the `page-text` page argument) are checked at the boundary, so a
typo is a usage error rather than a silently dropped value.

Batches of more than five rows are refused until you pass `--yes`, so a scope review
happens before anything is created. `delete` is refused without the exact current title.

Exit codes - 0 ok, 1 API or conversion error, 2 configuration or usage (no key, no
client id, bad arguments, unreadable inventory cache), 3 refused.

## The register

Heyzine keeps at most 200 characters of private note. The generated note drops
`published_by`, then `source_url`, then `source_name` until it fits (the result reports
`note_dropped`), and every command refuses a longer note, because over the cap Heyzine
silently discards the title, tags, note and template from an async conversion and answers
HTTP 500 on `flipbook-design`. Details, list and the rendered page also lag `processed`
by minutes; `publish` and `batch` wait for the title to appear before reporting.


Every flipbook the plugin makes carries its own provenance, so the Heyzine account is
the inventory and nothing has to be kept in sync beside it.

Tags are `facet:value` pairs.

| Tag | Values |
|---|---|
| `purpose:` | `lead-magnet`, `course-material`, `review`, `event`, `catalog`, `other` |
| `course:` | The course slug, for example `course:pcp` |
| `link:` | The the short domain short link slug |
| `source:` | `drive` or `url` |
| `published-by:` | `heyzine-plugin` |

The private note is `key = value` lines.

| Field | Meaning |
|---|---|
| `source_drive_id` | The Drive file id of the staged source, when there is one |
| `source_name` | The resource name the flipbook was published under |
| `source_url` | The source URL, when the source was not a Drive file |
| `idd_to` | The the short domain short link slug |
| `embedded` | Semicolon separated placements, for example `academy:chapter:123; academy:lesson:123` |
| `published` | The publish date |
| `published_by` | `heyzine-plugin` |

Hand written note lines that are not `key = value` are preserved. A `--note` passed on
the command line keeps only its free text - any `key = value` lines in it are dropped so
they cannot overwrite the generated register. Facet shaped values in `--tags` are
stripped the same way, so use `--purpose`, `--course` and `--idd-to` instead of hand
building tags. Passwords and access lists never go into either. `heyzine details <id>
--json` returns both parsed.

## Link rules

- Share URLs are reported on the configured public host (`docs.aflip.in` for the reference account) as well
  as on heyzine.com. Both serve the same flipbook by the same short id.
- Human facing links (academy materials, support replies, SMS, social posts) go through
  an the short domain short link made with the Short.io tools, named by resource type
  (`ios-review-medit-i900`) or course prefix (`pcp-flowchart-zirconia`), so a hosting
  change is one Short.io edit rather than a hunt. ActiveCampaign emails use the full
  direct URL, never a short link.
- Never expose a URL as anchor text. The anchor is the resource name.
- Course resources go in the LearnDash Materials field on the chapter and on the lesson,
  never on the public course page.
- A revised edition is the same Drive file overwritten in place (same file id, same URL)
  followed by `heyzine convert <url> --replace`. The id, both public URLs and the the short domain
  link all survive.

## Plan gates

Short form, current as at 2026-09-15. The full matrix is in
`skills/heyzine-api/plans.md` inside the plugin.

| Feature | Plan needed |
|---|---|
| Bookshelves, own DNS domain, one-time email access | Premium |
| Custom URL path and subdomain, reader statistics, lead forms | Professional |
| Own logo, no watermark, offline download | Standard |
| Five flipbooks, unlimited pages, API access | Free |
| `flipbook-replace` | Support enablement on any paid plan |

the reference account is on Premium. When the server refuses a feature it returns a plan message. Repeat
that message verbatim and stop; never downgrade the request silently. Free accounts keep
five flipbooks and drop the oldest past the cap.

## The MCP bridge and its security contract

`.mcp.json` starts `scripts/run-mcp.mjs`, which resolves the key through the shared
chain and execs `mcp-remote` against https://heyzine.com/mcp in `http-only` transport.
The bridge exposes 20 `heyzine_*` tools whose answers are markdown written for chat.
Desktop sessions sometimes do not spawn plugin MCP servers; when the tools are absent,
the CLI is the fallback, not a reason to stop.

The contract the launcher keeps, asserted by `test/launcher.test.js`.

- The key never appears in `argv`. It is written to a header file in the plugin data dir
  with mode 0600 and passed to `mcp-remote` as `--header-file`.
- The header file is named `mcp-remote-<pid>.headers`, one per launcher process, and the
  launcher touches only its own. Two bridges running at once (a desktop session and a
  terminal one, say) never share, overwrite or delete each other's file.
- The header file is removed before it is rewritten and again when the child exits, so
  it exists only for the life of one `mcp-remote` process. It holds a live credential in
  plain text and must never be copied, backed up or committed.
- The key and every variable that points at it are stripped from the child's
  environment.
- A multi-line key is refused rather than written.
- With no key configured, no header file is written, this process's own stale one is
  deleted, and
  `mcp-remote` runs Heyzine's OAuth sign in instead. The OAuth token works on MCP only.
- Everything written at runtime (`mcp-remote`, the header file, the inventory cache)
  goes to `${CLAUDE_PLUGIN_DATA}`, never the plugin root, which is replaced on update.

## What the API cannot do

- Bookshelves cannot be created or deleted through the API. Create the shelf in the
  Heyzine web app, then fill and order it with `shelf-add` and `shelf-remove`.
- A PDF can be replaced in place two ways, and both have a catch. `convert --replace`
  works on any account but runs on the blocking endpoint, so a large document can take a
  while and a reconversion may reset reader statistics. `flipbook-replace` keeps more
  intact but is support gated and is not enabled for the reference account.
- Access entries cannot be read back. `access-setup`, `access-add` and `access-remove`
  all work, but no list endpoint exists, so who has access has to be tracked wherever
  the grants were issued from.
- There is no analytics or statistics endpoint. Reader statistics exist on Professional
  and above, in the web app only.
- `heyzine_convert_attached_pdf` needs a chat attachment and is not usable from Claude
  Code.
- REST accepts full 40 character ids only. Short ids are resolved by the CLI, not by the
  API.

## Development

```bash
npm test          # node --test test/*.test.js
claude plugin validate .
```

ESM, Node 24, built-ins only, no runtime dependencies beyond the pinned `mcp-remote` the
hook installs. Every module in `lib/` takes its side effects (fs, exec, fetch, clock) as
injectable parameters and is unit tested without network access.

| Path | Holds |
|---|---|
| `lib/` | The library modules - config, client, links, register, convert, publish, inventory, csv, batch, cli |
| `bin/heyzine` | The CLI entry point |
| `scripts/` | `run-mcp.mjs` (the bridge launcher) and `install-deps.sh` (the SessionStart hook) |
| `hooks/hooks.json` | The SessionStart hook registration |
| `skills/` | The ten skills |
| `test/` | One test file per library module plus the launcher contract |
| `dev-docs/` | Tracked, dated, additive logs - API audits, smoke records, the release checklist |
| `.claude-plugin/` | `plugin.json` and `marketplace.json` only |

`docs/` is gitignored and local only. Release steps are in
`dev-docs/release-checklist.md`.

## Licence

MIT. See [LICENSE](LICENSE).

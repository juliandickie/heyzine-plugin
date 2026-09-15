---
name: heyzine-api
description: Reference for the Heyzine REST API, the hosted MCP server, oEmbed, the leads webhook payload, id and URL forms, async conversion states, plan gates and limits, and the heyzine CLI command table. Loaded when any skill or request needs an endpoint name, a parameter, a plan gate, a payload shape, or a curl example.
user-invocable: false
---

# Heyzine API reference

Verified against the live server on 2026-09-15 (server 1.7.0). Where the public
developers page and the live server differ, the live server wins and is noted.

## Authentication

- REST - `Authorization: Bearer <api key>` on `https://heyzine.com/api1/<endpoint>`.
  Convert endpoints also need `client_id` in the body.
- MCP - same Bearer key on `https://heyzine.com/mcp`, or OAuth 2.1 PKCE (scope `mcp`;
  an OAuth token never works on REST).
- Errors come back as HTTP 200 with `{"success": false, "code": 403, "msg": "..."}`.
  `Invalid user or api key` means the key is wrong; `Unauthorized` on a details call
  means the id is not in the account or is a short id (REST needs the full id);
  `Private API endpoint. Contact support@heyzine.com` means a support-gated endpoint.
  Unknown endpoints answer an HTML 404 page.

## Ids and URLs

- Full flipbook id - 40 hex chars plus `.pdf`. Full bookshelf id - 40 hex chars.
- Short id - the first 10 hex chars, used in `https://heyzine.com/flip-book/<short>.html`,
  `https://heyzine.com/shelf/<short>.html`, and the white-label host
  `https://<account>.aflip.in/<short>.html`.
- REST accepts full ids only. MCP tools accept full id, short id, public URL, or custom
  url path. The CLI accepts any form and resolves it through the inventory cache or the
  live list.

## CLI commands

| Command | REST or MCP behind it |
|---|---|
| `whoami` | `flipbook-list` count plus a `bookshelf-list` probe |
| `list [--limit --offset]` | `GET flipbook-list` |
| `details <id>` | `GET flipbook-details` (tags, private note, links, oembed) |
| `convert <url> [--wait] [--replace] [design flags]` | `POST async` polled until `processed` |
| `publish <source> --name ... [--purpose --course --idd-to --template --replace --note --description --embedded --skip-verify]` | convert, `flipbook-social`, `flipbook-details`, live GET of both URLs |
| `design <id> [design flags]` | `PATCH flipbook-design` (only supplied fields) |
| `social <id> --title --description --thumbnail` | `POST flipbook-social` |
| `replace-pdf <id> <url>` | `POST flipbook-replace` (support-gated) |
| `delete <id> --confirm "<title>"` | `POST flipbook-delete` |
| `shelves`, `shelf <id>`, `shelf-add <shelf> <fb> [--position]`, `shelf-remove`, `shelf-social` | `bookshelf-list`, `bookshelf-flipbooks`, `bookshelf-add`, `bookshelf-remove`, `bookshelf-social` |
| `access-setup <id> --mode`, `access-add <id> --access-type`, `access-remove <id>` | `access-setup`, `access-add`, `access-remove` (sends `id` and `name`) |
| `search <q>`, `page-text <id> <page>` | MCP `heyzine_search_text`, `heyzine_page_text` (no REST name exists) |
| `oembed <url>` | `GET oembed?url=&format=json` |
| `link-url <pdf url>` | builds `https://heyzine.com/api1?pdf=...&k=<client id>` |
| `drive-url <id>` | builds the Drive direct download URL |
| `mcp <tool> --args '{json}'` | any MCP tool by name |
| `inventory [--refresh]`, `reconcile <file> [--csv]`, `batch <csv> [--out path]` | see the inventory and batch-convert skills |

`reconcile --csv` writes rows with columns name, status, id, short, title, url, idd_to,
candidates instead of the default table. `batch --out <path>` chooses where the results
csv lands (default is the input file name with `.results.csv`). A reconcile status of
`exists` is reported only for a single exact or fuzzy title match; a substring match, or
more than one match at any tier, is always `ambiguous`.

Design flags - `--title --subtitle --description --private-note --tags --template
--download --full-screen --share --prev-next --show-info --background-color --logo
--page-effect --rtl --url-path --url-domain`. Booleans take `true` or `false`. Page
effects - magazine, book, album, notebook, fade, cards, coverflow, flip (aliases
slideshow = fade, onepage = flip). Exit codes - 0 ok, 1 API or conversion error, 2
configuration or usage (no key, no client id, bad arguments), 3 refused.

## REST endpoints

| Endpoint | Verb | Body or query | Notes |
|---|---|---|---|
| `rest` | POST | `pdf`, `client_id`, design fields, `replace` | Blocks until converted; large files exceed client timeouts |
| `async` | POST | same | Returns at once with `state` started, processed or failed; call again with the same `pdf` to poll; `replace: true` reconverts in place keeping the id |
| `flipbook-list` | GET | `limit`, `offset` | Array of `{id, date, title, subtitle, description, private, size, pages, links{custom, base, thumbnail, pdf}}`, no tags |
| `flipbook-details` | GET | `id` (full) | Adds `tags`, `oembed` |
| `flipbook-design` | PATCH | `id` plus any design field | Only supplied fields change; `url_path` and `url_domain` change the public link |
| `flipbook-social` | POST | `id`, `title`, `description`, `thumbnail` | Open Graph card; networks cache the old card |
| `flipbook-replace` | POST | `id`, `pdf` | Support-gated (refused on the reference account) |
| `flipbook-delete` | POST | `id` | Permanent |
| `bookshelf-list` | GET | | Premium. `{id, date, title, subtitle, description, flipbook_count, links{url, thumbnail}}` |
| `bookshelf-flipbooks` | GET | `id` | Adds `position` (zero-based) |
| `bookshelf-add` | POST | `id`, `flipbook_id`, `position` | Appends when position omitted |
| `bookshelf-remove` | POST | `id`, `flipbook_id` | Membership only |
| `bookshelf-social` | POST | `id`, `title`, `description`, `thumbnail` | |
| `access-setup` | POST | `name` (id), `type`, `mode` disabled, everyone, users, `password`, `text_user`, `text_password` | `everyone` needs `password` |
| `access-add` | POST | `name`, `type`, `access_type`, `user`, `password` | Types user_pass, google, pass_only, otp, email_link, email_code, send_code (last three Premium) |
| `access-remove` | POST | `name`, `type`, `user` or `password` | No list endpoint exists |
| `oembed` | GET | `url`, `format`, `maxwidth`, `maxheight` | Public, returns the iframe html |

Link conversion (no key) - `https://heyzine.com/api1?pdf=<url>&k=<client id>&t=&s=&ds=&d=1&fs=1&sh=1&pn=1&st=1&bg=&lg=&pe=&rtl=1&tpl=` converts on first visit and redirects to the flipbook.

## MCP tools

`heyzine_convert_attached_pdf` (attachments only, not usable from Claude Code),
`heyzine_convert_pdf_async`, `heyzine_convert_pdf`, `heyzine_list_flipbooks` (offset,
limit), `heyzine_flipbook_details`, `heyzine_update_flipbook_design`,
`heyzine_replace_flipbook_pdf`, `heyzine_delete_flipbook`, `heyzine_set_flipbook_social`,
`heyzine_set_bookshelf_social`, `heyzine_list_bookshelves`,
`heyzine_list_bookshelf_flipbooks`, `heyzine_add_to_bookshelf`,
`heyzine_remove_from_bookshelf`, `heyzine_access_setup`, `heyzine_access_add`,
`heyzine_access_remove`, `heyzine_search_text` (q), `heyzine_page_text` (n, p),
`heyzine_oembed`. Results are markdown for chat; `search_text` returns JSON
`{success, data: [{flipbook, page, text}]}`. Failed tools return `isError: true` with
the message.

## Leads webhook

Configured at https://heyzine.com/account/#scripts (Professional or above). Heyzine
POSTs `{"data": {"id_webhook", "date", "leads": [{"date", "first_value",
"second_value", "flipbook": {"id", "title"}, "answer": [{"label", "value"}]}]}}` to a
URL you host. The plugin documents the shape; a Cloudflare Worker is the natural
receiver when one is wanted.

## Plan gates

See [plans.md](plans.md) for the full matrix. Short form - bookshelves, own DNS domain
and one-time email access need Premium; custom URL path and subdomain, statistics and
lead forms need Professional; logos need Standard; `flipbook-replace` needs support
enablement on any paid plan. Free keeps five flipbooks. Fair use, no published rate
limit; the CLI retries 429 and 5xx three times with backoff.

## curl examples

```bash
KEY="$(python3 -c "import re,os;print(re.search(r'^\s*api_key\s*=\s*\"([^\"]*)\"',open(os.path.expanduser('~/.config/heyzine-plugin/config.toml')).read(),re.M).group(1))")"
curl -sS -H "Authorization: Bearer $KEY" 'https://heyzine.com/api1/flipbook-list' | head -c 400
curl -sS -H "Authorization: Bearer $KEY" 'https://heyzine.com/api1/flipbook-details?id=<full id>'
curl -sS -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' -X POST 'https://heyzine.com/api1/async' -d '{"pdf":"https://example.com/doc.pdf","client_id":"<client id>","title":"Doc"}'
```

Prefer the CLI; curl is for confirming a raw response shape.

---
name: heyzine
description: Overview and router for the Heyzine flipbook plugin. Use when the user mentions Heyzine, flipbooks, aflip.in links, turning a PDF into a flipbook, a flipbook for a lead magnet or course, a bookshelf, or password protecting a document. Explains which skill to use, the register schema (tags and private note), the link rules, the plan gates, and the two ways in (CLI first, MCP tools second).
argument-hint: ""
---

# Heyzine plugin - overview and router

Heyzine turns PDFs (and Word, PowerPoint, OpenDocument, RTF) into hosted flipbooks.
This plugin publishes them and carries them the rest of the way - lead magnets,
LearnDash course material, website embeds, bookshelves, access lists.

## Two ways in

1. The `heyzine` CLI (on the Bash PATH while the plugin is enabled). REST under the
   hood, JSON output with `--json`, runs unattended, and works in every session. Every
   skill names the CLI command first. `heyzine help` lists the commands.
2. The `heyzine` MCP server (20 tools named `heyzine_*`, for example
   `heyzine_list_flipbooks`). Same account, same key, markdown answers written for chat.
   Use it for ad-hoc questions when the tools are loaded. If the tools are absent in a
   session (the host sometimes does not spawn plugin servers), the CLI is the fallback,
   not a reason to stop.

Publishing from the CLI runs a source preflight - a redirecting or non-document URL is
warned about, an HTTP 4xx source is refused - and a note passed with --note keeps only
its free text (key = value lines are dropped so they cannot overwrite the register).

Both need a key. Run `/heyzine:setup` once per machine.

## Which skill

| Want to | Skill |
|---|---|
| Configure the key, client id, public host, template, staging folder | `/heyzine:setup` |
| Publish one document end to end | `/heyzine:publish` |
| Lead magnet share kit (URL, embed, button, short link, social card) | `/heyzine:lead-magnet` |
| Course PDF into LearnDash Materials with a short link | `/heyzine:course-material` |
| Fill, order or brand a bookshelf | `/heyzine:bookshelf` |
| Password or per-user access | `/heyzine:access` |
| Find, list, search text, reconcile a names list against the account | `/heyzine:inventory` |
| Convert many documents unattended | `/heyzine:batch-convert` |
| Endpoint, parameter, plan gate or payload reference | `heyzine-api` (loaded automatically) |

## The register lives inside Heyzine

Every plugin-made flipbook carries tags and a private note so the account itself is
the inventory. Tags are `facet:value` - `purpose:lead-magnet|course-material|review|
event|catalog|other`, `course:<slug>`, `link:<the short domain slug>`, `source:drive|url`,
`published-by:heyzine-plugin`. The private note is `key = value` lines -
`source_drive_id`, `source_name`, `source_url`, `idd_to`, `embedded` (semicolon list
such as `academy:chapter:123; academy:lesson:124`), `published`, `published_by`.
Hand-written note lines are preserved. Passwords and access lists never go into
either. `heyzine details <id> --json` shows both parsed.

## Link rules

- Share URLs are reported on the configured public host (for example `docs.aflip.in`) and
  on heyzine.com; both serve the same flipbook by short id.
- Human-facing links (academy materials, support replies, SMS, social) go through an
  short link made with the Short.io tools, named by resource type
  (`ios-review-medit-i900`) or course prefix (`pcp-flowchart-zirconia`), so a hosting
  change is one Short.io edit. ActiveCampaign emails use the full direct URL, never a
  short link.
- Never expose a URL as anchor text. The anchor is the resource name.
- Course resources go in the LearnDash Materials field on the chapter and the lesson,
  never on the public course page.

## Revisions

Converting the same URL twice returns the same flipbook. A revised edition is the same
Drive file updated in place (same file id, same URL) then
`heyzine convert <url> --replace --wait`, which keeps the id, both public URLs and the
short link. `replace-pdf` needs Heyzine support to enable the account and is not
enabled on the reference account.

## Plan gates and limits

Bookshelves need Premium; custom URL path and subdomain need Professional; own DNS
domain and one-time email access need Premium; logos need Standard; `flipbook-replace`
needs support enablement. The reference account is on Premium. The server reports a refused feature with
a plan message - repeat it verbatim and stop, never downgrade the request silently.
Free accounts keep five flipbooks and drop the oldest.

## House rules

- Archive over delete. `heyzine delete` needs `--confirm "<exact current title>"`, and a
  delete is only ever an explicit user decision, never cleanup.
- Verify by looking. A publish is done when both public URLs answer 200, the oEmbed
  html exists, and the page count matches.
- Batches over five rows get a scope review (names, sources, purposes) before running.
- Never print, log or paste the API key.

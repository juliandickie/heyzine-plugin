---
name: inventory
description: Find and audit Heyzine flipbooks - refresh the local inventory cache, list by tag, course or title, search the full text of every flipbook, read a page's text, and reconcile a list of resource names against the account to find which already have flipbooks. Use when the user says which PDFs already have flipbooks, find the flipbook for, search the flipbooks for, what is on Heyzine, reconcile this list, or the create list.
argument-hint: "[--refresh | reconcile <names file> | search <text>]"
---

# Heyzine - Inventory, search and reconcile

## Cache

`heyzine inventory --refresh --json` lists every flipbook and fetches details for each
(tags, private note, links, oEmbed) into `inventory.json` in the plugin data dir, with
`fetched_at`. About a minute for a hundred flipbooks. `heyzine inventory --json` reads
the cache. Refresh before any reconcile or batch, and whenever the account changed
outside the plugin.

Each item carries `short`, `title`, `pages`, `date`, `tags`, `public_url` (public
host) and `register` (the parsed note - `source_drive_id`, `idd_to`, `embedded`,
`published`). Filter with `node -e` or `jq` on the JSON; for example flipbooks tagged
for a course:

```bash
heyzine inventory --json | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8'));for(const i of j.items)if(/course:pcp/.test(i.tags))console.log(i.short,i.title,i.public_url)"
```

## Search

`heyzine search "<text>" --json` searches the text of every flipbook and returns the
short id, page and snippet per hit (MCP `heyzine_search_text`). `heyzine page-text
<id> <page>` returns one page's text (MCP `heyzine_page_text`). Use these to find
which flipbook contains a passage, or to quote a page for a description.

## Reconcile a names list

```bash
heyzine reconcile <file> --json
```

The file may be a markdown table with an "Anchor name" column (the academy resource
decks), a CSV with a `name` column, or one name per line. Titles are normalised
(case, punctuation, "PDF", "Review PDF", trailing "- the reference account") and matched exact, then by
token overlap of at least 0.8, then by substring. Each row comes back as `exists`
(one clear match with id, url and current `idd_to`), `ambiguous` (candidates listed;
decide by eye and never auto-pick), or `missing` (the create list). A substring-tier
match is always `ambiguous`, never `exists`, even when it is the only candidate - a
human decides. Several candidates at any tier are also `ambiguous`. Present the three
groups with counts. For `exists` rows whose the short domain link still points at a wp-content
PDF, the follow-up is a Short.io edit to the public host URL, not a new flipbook.

`heyzine reconcile <file> --csv` writes a spreadsheet shape instead, with columns
`name, status, id, short, title, url, idd_to, candidates` (candidates flattened to one
cell as `short title (tier)` joined by `; ` so the file opens cleanly in Sheets).

Existing example - the 2026-09-15 academy bridge deck listed 55 PDFs as "please
create"; at least twelve already had flipbooks in the account.

## Report

Counts first (exists, ambiguous, missing), then the rows, then the proposed actions
(Short.io edits for exists, decisions for ambiguous, a batch CSV for missing).

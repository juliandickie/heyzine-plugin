---
name: publish
description: Publish one document as a Heyzine flipbook end to end - stage a local PDF on Google Drive, convert it, apply the template and purpose defaults, set the social card, write the register tags and note, verify both public URLs, and report. Use when the user says publish this PDF, make a flipbook, convert this document, put this on Heyzine, or update the flipbook with a new edition.
argument-hint: "<file, Drive link or URL> [--purpose lead-magnet|course-material|review|event|catalog]"
---

# Heyzine - Publish one document

The CLI does the whole flow in one command once the source is reachable by URL. The
work in this skill is getting the source staged, choosing the purpose, and verifying.

## 1. Resolve the source

- A public URL - use it as is; the CLI preflight checks it. If the user gives a page URL
  rather than the file, ask for the file link.
- A Google Drive file link or id - use it directly; the CLI builds the direct download
  URL. Confirm the file is shared anyone-with-link (Scribe plugin's permission check).
- A local file - stage it first with the Scribe plugin's Drive tools: upload into the
  staging folder (`staging_folder_id` from `heyzine whoami`), name the file after the
  resource ("Medit i900 Intraoral Scanner Review.pdf"), set anyone-with-link reader,
  and take the file id. The staged file is permanent - it is the source of truth for
  revisions.

The CLI runs a source preflight before converting. A redirecting or non-document URL
prints `heyzine: source warning - ...` on stderr and the conversion continues - read
the warning but let it proceed unless it names the wrong resource. An HTTP 4xx source
is refused outright with a validation error - fix the URL or the sharing and retry. A
non-public Drive file surfaces as this same warning with `content-type text/html` -
treat that specific warning as a stop, fix the file's sharing to anyone-with-link in
Drive, and only then re-run.

## 2. Check for an existing flipbook first

Run `heyzine inventory --json` (refresh with `--refresh` if older than a day) and look
for the same Drive id in `register.source_drive_id` or the same title. An existing
match means this is a revision, not a new publish - go to step 5. Never create a second
flipbook for a resource that already has one unless the user says so.

## 3. Choose the purpose

| Purpose | Defaults | Typical use |
|---|---|---|
| `lead-magnet` | download on, share off, fullscreen, arrows | Free guides, checklists, buyers guides. Share stays off so readers pass on the opt-in page, not the PDF |
| `course-material` | download on, share off, fullscreen, arrows | Chapter and lesson resources behind enrolment. Download stays on because many double as worksheets and checklists |
| `review` | download on, share off | Product review PDFs that outlive any course. Share is off because Heyzine's share button cannot be pointed at the opt-in page or article that captures the email |
| `event` | download off, share on | Event guides, agendas |
| `catalog` | download on, share on | Price guides, catalogs |
| `other` | account defaults | Anything else |

Override any default with a design flag (`--download false`).

## 4. Publish

```bash
heyzine publish "<source>" --name "<Resource Name>" --purpose <purpose> [--course <slug>] [--idd-to <slug>] [--description "<one line>"] [--template <id>] [--embedded "academy:chapter:123; academy:lesson:123"] [--note "<free text>"] --json
```

The command converts (polling every 5 s, up to 15 min), applies the configured
template unless `--template` overrides it, writes the register tags and private note,
sets the social card (title, description, Heyzine's cover as the thumbnail; run
`heyzine social <id> --thumbnail <url>` afterwards for a designed card image), fetches
details, and GETs both public URLs. `--note` keeps only free text - any `key = value`
lines are dropped so they cannot overwrite the generated register. Facet-shaped values
in `--tags` (`purpose:`, `course:`, `link:`, `source:`, `published-by:`) are stripped
silently the same way - use `--purpose`, `--course` and `--idd-to` instead of
hand-building tags. The JSON result has `id`, `short`, `url` (public host), `base`
(heyzine.com), `pages`, `oembed`, `tags`, `private`, `polls`, `verify`.

MCP alternative for a quick one-off - `heyzine_convert_pdf_async` with the same
fields, then `heyzine_set_flipbook_social` and `heyzine_flipbook_details`. The register
fields (`tags`, `private_note`) must still be sent.

## 5. Revision of an existing flipbook

Overwrite the staged Drive file's contents in place with the Scribe plugin (same file
id, same URL), then:

```bash
heyzine convert "$(heyzine drive-url <file id> --json | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).url")" --replace --wait --json
```

The id, both public URLs and the the short domain link survive. Confirm `heyzine details <id>`
shows the new page count. After a revision, refresh the `published` date: read the
current note with `heyzine details <id> --json`, edit the `published` line, and write
it back with `heyzine design <id> --private-note "<full note>"` (the design command
overwrites the whole note, so always write the full text). `replace-pdf` is the
alternative only for accounts Heyzine support has enabled.

## 6. Verify by looking

`verify` in the result must show both URLs at 200. Open the public host URL in the
browser and look at the first page. `heyzine oembed <url>` must return html. If a URL
is not 200 yet, wait 30 s and re-run `heyzine details <id>`; conversions can trail by a
few seconds after `processed`.

## 7. Report

Public host URL first, then the heyzine.com URL, id, page count, template applied,
purpose defaults, and the register written. Say plainly when verification was skipped
or a URL was not yet 200.

## Failure handling

- Exit 2 - configuration or usage (no key, no client id, bad arguments). Point at
  `/heyzine:setup` for configuration; recheck the command for a usage error.
- `conversion_failed` - report Heyzine's message; check the direct URL with
  `curl -sS -o /dev/null -D - -r 0-0 "<url>"` for a redirect or a non-PDF content type.
- An HTTP 4xx source at the preflight is refused with a validation error - fix the URL
  or the Drive sharing and retry. A non-public Drive file shows as a `content-type
  text/html` warning first; treat that warning as a stop, not something to push through.
- `plan` - repeat the server's message and stop; do not remove the feature silently.
- `timeout` - the conversion continues on Heyzine's side; poll again with the same
  command later.

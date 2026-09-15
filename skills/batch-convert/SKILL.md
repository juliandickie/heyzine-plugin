---
name: batch-convert
description: Convert many documents into Heyzine flipbooks unattended from a CSV, a Google Sheet or a Drive folder - stage, convert with bounded concurrency, apply template and purpose defaults, set social cards, write the register, and write a results CSV with counts. Use when the user says batch, convert all of these, the create list, bulk flipbooks, or run the whole folder.
disable-model-invocation: true
argument-hint: "<batch.csv> [--yes] [--concurrency 2]"
---

# Heyzine - Batch convert

## 1. Build the CSV

Columns (template at `${CLAUDE_PLUGIN_ROOT}/skills/batch-convert/batch-template.csv`) -
`name, source, purpose, course, idd_to, template, download, tags, note, description, replace, url_path, embedded`.
`source` is a Drive file id or link, or a public URL; local files are staged first
with the Scribe plugin's Drive tools into the staging folder, named after the
resource, shared anyone-with-link, and their ids written into the column. From a
Google Sheet, export the rows with the Scribe plugin's Sheets tools into the CSV.
`download` and `replace` take true or false. Empty cells fall back to the purpose
defaults and the configured template. A non-empty cell in a boolean column that is
neither (anything outside true, 1, yes, y, false, 0, no, n) fails that row with
`validation: column <name> has an unrecognised boolean value "..."` rather than reading
as false, so a typo shows up in the results CSV instead of quietly publishing the wrong
design.

The `tags` column cannot carry facet-shaped values (`purpose:`, `course:`, `link:`
and the rest) - they are stripped silently the same way `--tags` is on a single
publish, so use the `purpose`, `course` and `idd_to` columns for those, and `tags`
only for genuinely free-standing labels. The `note` column keeps only free text -
any `key = value` line in it is dropped rather than allowed to overwrite the
generated register.

The results CSV carries a `register` column - `settled` means the title was read back from
`flipbook-details`, `pending` means it had not appeared within five minutes (the record lags
`processed`); re-check pending rows with `heyzine details` before handing links on.

## 2. Scope review

Run `heyzine inventory --refresh` so existing flipbooks are skipped. Present the batch
to the user before running - row count, names, sources, purposes, which rows the
inventory already matches (these are skipped unless `replace` is true), and the
estimated time (about 30 to 90 s per document, two at a time). Wait for the go. The
CLI refuses more than five rows without `--yes` (exit code 3), which is the record of
that go.

## 3. Run

```bash
heyzine batch <batch.csv> --yes --concurrency 2 [--skip-verify] --json
```

Add `--skip-verify` to skip the per-row live GET of both public URLs when the batch is
large and you will verify a sample by eye afterwards. Without it every converted row is
checked, but the check does not change the row's status - a row whose URLs do not answer
200 is still reported `converted`, with both URLs in the results so the operator can open
them. There is no verify column in the results CSV; read the status, then open the URLs.

Progress goes to stderr one line per row. Each row runs the same source preflight as
a single publish - a non-public Drive file fails that row alone with a content-type
warning in its error column rather than aborting the batch. A `replace` row runs on
the slower blocking endpoint (no polling) but keeps the flipbook's id and both public
URLs.

The result JSON has `results_path` (the CSV written beside the input as
`<name>.results.csv` unless `--out <path>` is given - pass `--out` to a permanent
location when the batch is run from a scratch or scratchpad directory, since nothing
else will find the results there later), `summary` (`total`, `converted`, `replaced`,
`skipped`, `failed`), and the rows with id, both URLs, pages and any error.
Re-running the same CSV is safe - conversion is idempotent per URL and the inventory
preflight skips rows that already exist.

For unattended runs from a script or a scheduled task, the config file supplies the
key; nothing needs a person present.

## 4. After the run

- Failed rows - read the error column. `conversion_failed` usually means the source
  URL redirected or was not a document; check with
  `curl -sS -o /dev/null -D - -r 0-0 "<url>"`. A non-public Drive file shows as a
  `content-type text/html` warning caught at the preflight - fix the file's sharing to
  anyone-with-link and re-run; only the failed rows convert again.
- Short links - for each converted row with `idd_to`, create or edit the the short domain link
  with the Short.io tools to the public host URL. Write the results CSV back to the
  Sheet with the Scribe plugin's Sheets tools when the batch came from one.
- Verify by looking - open three public URLs across the batch, not just one.

## 5. Report

Counts first, then failures with reasons, then the results path. Never say complete
while any row failed; say converted N, skipped N, failed N.

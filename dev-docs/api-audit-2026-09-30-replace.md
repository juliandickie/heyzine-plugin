# flipbook-replace, enabled and tested - 2026-09-30

Heyzine support enabled the replace endpoint and the MCP tool on the reference account. Tested the same day against the standing smoke flipbook, six replacements, state restored afterwards.

- It works, on both paths. REST `POST /api1/flipbook-replace` with `{id, pdf}` (the CLI `replace-pdf <id> <url>`) and the MCP tool `heyzine_replace_flipbook_pdf`. The old answer "Private API endpoint. Contact support" is gone.
- It is synchronous. 5 to 6 s per call, including a 26 page, 1.9 MB document. The answer carries `id`, `url`, `thumbnail`, `pdf` and `meta.num_pages`; `flipbook-details` shows the new page count and PDF at once (no settle lag, unlike a first conversion).
- What survives. The id, both public URLs, title, subtitle, tags, private note, the design (template, download on, share off) all survived every replacement. The stored PDF name gains a revision suffix each time (`-3`, `-4` ... ) and the cover thumbnail is regenerated. Reader statistics are promised by the tool description ("keeping its id, URL, design and statistics") but cannot be read through the API, so that part is unverified.
- The source may be a DIFFERENT URL. This is the difference from `convert --replace`, which only reconverts the URL the flipbook was first made from.
- The URL check is stricter than convert's, and it is about the content type, not the file extension. Answer when refused - HTTP 200 body `{"success":false,"code":422,"msg":"The URL is not a direct link to a file or is an invalid file type. Supported types are pdf,docx,doc,odp,odt,ppt,pptx,rtf"}`, in 1 to 3 s, flipbook untouched.

| Source | Content-Type seen | Result |
|---|---|---|
| Heyzine CDN `.pdf` (same flipbook, and another flipbook) | `application/pdf` | accepted |
| Third-party static host, `.pdf` path | `application/pdf` | accepted |
| Google Drive `drive.usercontent.google.com/download?id=...` (two files) | `application/octet-stream` | refused |
| Same Drive URL with `&name=x.pdf` or `&f=/x.pdf` appended | `application/octet-stream` | refused |
| raw.githubusercontent.com, `.pdf` path | `application/octet-stream` | refused |
| w3.org test file, `.pdf` path | `application/pdf; qs=0.001` | refused |
| WordPress uploads behind Cloudflare, `.pdf` path | `application/pdf` to a browser or curl, HTTP 403 to a request with an empty User-Agent | refused |

- Reading. The validator wants an exact `application/pdf` (or the matching office type) on a plain fetch. The Cloudflare-fronted host is the one open question - it refuses an empty User-Agent, which would explain the refusal, but Heyzine's fetcher was not observed, so this is an inference. `convert` accepts that host and Drive URLs; the two endpoints validate differently.
- Consequences for the plugin.
  - Drive-staged sources cannot use `replace-pdf`. Their revision path stays as it was - overwrite the Drive file in place, then `convert <same url> --replace` (blocking endpoint).
  - `replace-pdf` is the path when the new edition lives at a different URL, provided the host serves `application/pdf` to a bare client.
  - A Heyzine CDN PDF is a valid source, so one flipbook's document can be copied onto another.
- CLI gaps found on the way.
  - `heyzine drive-url <id>` prints `url: <url>` in its human form; piping it into another command passes the prefix. Use `--json`.
  - `heyzine design --subtitle ""` is refused ("No design fields given") because empty values are dropped, and the API itself ignores an empty string, so a subtitle cannot be cleared once set. A single space is accepted and renders blank.
  - Skills and README still said replace was not enabled on the reference account. Fixed in 0.1.5, which also adds the content type hint to the `replace-pdf` refusal.

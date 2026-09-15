---
name: course-material
description: Publish a course PDF as a Heyzine flipbook and hand it to LearnDash - course-prefixed the short domain link through the Short.io tools, the Materials snippet in the light or PCP format for the chapter and the lesson, the description anchor line, and the register entry. Use when the user says course resource, chapter PDF, lesson materials, add this PDF to the academy, flipbook for the course, or replace the PDF in a lesson.
argument-hint: "<file, Drive link or URL> --name \"<Resource Name>\" --course <slug> [--chapter <id>] [--lesson <id>]"
---

# Heyzine - Course material into LearnDash

## 1. Publish

Follow `/heyzine:publish` with `--purpose course-material --course <slug>` and
`--embedded "academy:chapter:<id>; academy:lesson:<id>"` when the targets are known.
Download is off by default; ask if students should be able to download.

Check first whether the resource already has a flipbook (`heyzine inventory`, or
`heyzine reconcile` for a list) - many academy PDFs do, and a second copy splits the
statistics and the links.

## 2. the short domain link

Every academy link to a hosted resource goes through an the short domain link so a hosting change
is one Short.io edit. Use the Short.io tools - search by destination, reuse an existing
link (the six PCP documents already have `pcp-*` links), otherwise create one. Slug
rule - course prefix for a course's own resources (`pcp-flowchart-zirconia`,
`mef-ch04-inlays-onlays`), resource type for standalone review PDFs that outlive a
course (`ios-review-medit-i900`, `printer-review-formlabs-form-4b`). Record the slug
on the flipbook with `heyzine design <id> --idd-to <slug>` if it was not passed at
publish time - never hand-build the `link:` tag with `--tags` (facet-shaped values
there are stripped silently); the tag and the `idd_to` note field are both set by the
proper flag.

## 3. Materials snippet

Two formats are in use; the user chooses per course.

Light (the free PDF courses, where the PDF is the product) - one line per PDF:

```html
<p><a href="https://the short domain/<slug>">Resource Name</a></p>
```

PCP paragraph (a course's companion resources):

```html
<p><strong>Resource Name (PDF).</strong> One sentence on what it is for. <a href="https://the short domain/<slug>">Resource Name</a>.</p>
```

Description anchor line, when the chapter or lesson description should mention it -
`[Resource Name](https://the short domain/<slug>)`. The anchor is always the resource name,
never the URL or the filename.

## 4. Hand off to LearnDash

This plugin does not write to WordPress. Hand the snippet, the chapter id and the
lesson id to the academy tooling - the academy's LearnDash settings tooling
(snapshot first, never a bare Materials POST) - or to the
wp-manager plugin for plain pages. Rules that travel with the handoff:

- Materials go on the chapter AND the lesson.
- Never on the course page - it is public and the flipbook has no access gate of its
  own. The course page may name the resource without a link.
- For an href-only change on legacy Gutenberg content, swap in place with the
  both-ways assertion (replacement count, reverse substitution restores the original),
  never rewrite from a deck.

## 5. Gate the content when needed

Enrolment already hides Materials from non-students. When the flipbook URL itself must
be protected (shared outside the academy, or a paid standalone resource), use
`/heyzine:access` - a shared password for a cohort, or per-student email codes on
Premium.

## 6. Record and verify

`heyzine details <id> --json` must show `purpose:course-material`, `course:<slug>`,
`link:<slug>`, and `embedded` naming the chapter and lesson. Open the public host URL
and the the short domain link (read its configured destination from the Short.io tools, not the
HTTP status). Report the URL, the the short domain link, the snippet, and the exact chapter and
lesson ids the snippet is for.

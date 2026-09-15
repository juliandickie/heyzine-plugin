---
name: lead-magnet
description: Turn a PDF into a Heyzine lead magnet and produce the share kit - public and heyzine.com URLs, oEmbed iframe, button and anchor snippets, an the short domain short link through the Short.io tools, and the social card. Use when the user says lead magnet, free download, opt-in PDF, share kit, embed the flipbook on the landing page, or link to the guide from the thank-you page.
argument-hint: "<file, Drive link or URL> --name \"<Resource Name>\" [--idd-to <slug>]"
---

# Heyzine - Lead magnet share kit

## 1. Publish

Follow `/heyzine:publish` with `--purpose lead-magnet` (download on, share off - readers are sent to the opt-in
page, never the PDF directly). Keep
the JSON result.

## 2. Short link

Make or reuse an the short domain link with the Short.io tools - search by destination first
(the public host URL), then create with a slug by resource type in lowercase hyphens
(`digital-buyers-checklist`, `ios-price-guide` without a year so the next edition is a
Short.io edit). Record the slug on the flipbook with the proper flag if it was not
passed at publish time - never hand-build the tag with `--tags` (facet-shaped values
such as `link:<slug>` are stripped from `--tags` silently):

```bash
heyzine design <id> --idd-to <slug>
```

A 200 from the short domain proves nothing (unknown slugs redirect to the homepage); read the
configured destination back from the Short.io tools.

## 3. Embed and link snippets

`heyzine oembed <public url> --json` returns the iframe. Do not edit its attributes;
wrap it for responsive layouts instead.

```html
<!-- embed -->
<div style="max-width: 900px; margin: 0 auto;">
  <iframe allowfullscreen="allowfullscreen" allow="clipboard-write" scrolling="no" class="fp-iframe" style="width: 100%; height: 600px;" src="https://docs.aflip.in/<short>.html"></iframe>
</div>
<!-- button -->
<a class="button" href="https://the short domain/<slug>" target="_blank" rel="noopener">Read the <Resource Name></a>
<!-- anchor in text -->
<a href="https://the short domain/<slug>">Resource Name</a>
```

Markdown anchor - `[Resource Name](https://the short domain/<slug>)`.

## 4. Social card

`heyzine social <id> --title "<name>" --description "<one line>" --thumbnail <1200x630 image url>` when a designed card image exists (Heyzine's cover is used otherwise). Social networks cache the old card for a shared URL.

## 5. Where each link goes

| Surface | Link |
|---|---|
| Landing page button, thank-you page, website text | the short domain short link |
| Support replies, SMS, social posts | the short domain short link |
| ActiveCampaign emails | full public host URL (short links are for humans, and seg_cid only populates in AC) |
| Page embed | oEmbed iframe |

## 6. Write the kit

Save `<resource-slug>-share-kit.md` beside the source (or in the session scratchpad
when the source is remote) with - resource name, both URLs, the the short domain link and its
configured destination, the iframe, the button and anchor snippets, the social card
fields, the flipbook id and page count, the date. Report the file path and the public
URL.

---
name: bookshelf
description: Fill, order and brand Heyzine bookshelves - list shelves, inspect contents in display order, add a flipbook at a position, remove one, reorder, and set the shelf's social card. Use when the user says bookshelf, shelf, library, collection of flipbooks, put this on the reviews shelf, or reorder the shelf.
argument-hint: "<shelf id or url> [add|remove|reorder|social]"
---

# Heyzine - Bookshelves

Bookshelves are Premium. A shelf references flipbooks; adding or removing membership
never copies or deletes a flipbook.

## What the API cannot do

Create, rename, delete, or reorder a shelf in place. Say so plainly and point at the
Heyzine bookshelf editor for those. The reference account has eight shelves (reviews by
category, course companions, workflow guidebooks).

## Commands

```bash
heyzine shelves --json                          # all shelves with ids and urls
heyzine shelf <shelf> --json                    # contents in display order with position
heyzine shelf-add <shelf> <flipbook> [--position N]   # zero-based; appended when omitted
heyzine shelf-remove <shelf> <flipbook>
heyzine shelf-social <shelf> --title "<t>" --description "<d>" --thumbnail <image url>
```

Ids accept a full id, short id or URL (`https://heyzine.com/shelf/<short>.html` or a
slug URL such as `https://heyzine.com/shelf/perfect-ceramic-processing-pdfs`). In
membership commands the first argument is always the shelf, the second the flipbook.

MCP alternative - `heyzine_list_bookshelves`, `heyzine_list_bookshelf_flipbooks`,
`heyzine_add_to_bookshelf`, `heyzine_remove_from_bookshelf`,
`heyzine_set_bookshelf_social`.

## Reorder

There is no move call. To move a flipbook to position N - `shelf-remove` then
`shelf-add --position N`. For a whole new order, list the shelf, compute the moves,
present them, then apply in order from position 0 upwards and list again.

## Resolve names first

When the user names a shelf or flipbook by title, list and match. Proceed on one clear
match; show candidates and ask when several plausibly match; report and stop when none
match. Never guess an id.

## Verify and report

After any change run `heyzine shelf <shelf> --json` and report the resulting order and
count, the shelf URL, and any failed items. For a batch, counts rather than a play by
play.

---
name: access
description: Password and access control for Heyzine flipbooks and bookshelves - a shared password for everyone, per-user credentials, Google sign-in, one-time passwords, email links and codes on Premium, bulk grants from a CSV or Sheet, and revocation. Use when the user says password protect, lock the flipbook, give the cohort access, add a student, revoke access, or make it public again.
argument-hint: "<flipbook or shelf id> [--mode everyone|users|disabled]"
---

# Heyzine - Access control

Protection has a mode on the publication plus, for `users` mode, credential entries.

## Modes

```bash
heyzine access-setup <id> --mode everyone --password "<shared>" [--type bookshelf]
heyzine access-setup <id> --mode users [--text-user "Your email"] [--text-password "Your code"]
heyzine access-setup <id> --mode disabled        # makes it public again - confirm first
```

Set the mode before adding entries in `users` mode.

## Entries

```bash
heyzine access-add <id> --access-type user_pass --user "<email>" --password "<pw>"
heyzine access-add <id> --access-type google --user "<google email>"
heyzine access-add <id> --access-type pass_only --password "<pw>"
heyzine access-add <id> --access-type otp --password "<one time pw>"
heyzine access-add <id> --access-type email_link --user "<email>"     # Premium
heyzine access-add <id> --access-type email_code --user "<email>"     # Premium
heyzine access-add <id> --access-type send_code --user "<email>"      # Premium, emails a code immediately
heyzine access-remove <id> --user "<email>"          # or --password "<pw>" for password-only entries
```

Add `--type bookshelf` when the target is a shelf. MCP alternative -
`heyzine_access_setup`, `heyzine_access_add`, `heyzine_access_remove`.

## Bulk grants

Read the list with the Scribe plugin's Sheets tools or from a CSV, one entry per row
(`user`, `access_type`, optional `password`), present the count and the access type,
then run one `access-add` per row and report added and failed counts with the failed
users. Do not switch access types when the server refuses one (a Premium type on a
lower plan) - report the plan message and stop.

## What cannot be done

No endpoint lists current entries. For an audit, point at the flipbook's access
settings in the Heyzine UI. Do not claim an earlier conversation reflects the current
list.

## Credentials hygiene

Generate a password only after the user accepts the offer. Never write passwords into
the flipbook's private note, tags, a share kit, or a file unless the user explicitly
asks for a credential document. Repeat a shared password in chat only when the user
needs it for distribution. The CLI never echoes passwords in its output.

A password given with `--password` appears in the process list and in the session
transcript on disk. Prefer `--password-stdin` and pipe the value in (for example
`printf '%s\n' "$PW" | heyzine access-add <id> --access-type pass_only --password-stdin`),
which keeps it out of both.

## Report

State the publication, the resulting mode, and each entry added or removed. Before
`disabled`, state the title and that the publication becomes public, and get a yes.

---
name: setup
description: First-run setup for the Heyzine plugin - configure the API key (config file for unattended use, plugin config field, 1Password reference, or OAuth), the client id, the public host, the default template, the Drive staging folder, then verify with heyzine whoami.
disable-model-invocation: true
argument-hint: ""
---

# Heyzine - Setup

Run once per machine, and again whenever the key rotates.

## 1. Get the credentials

Both values are on https://heyzine.com/developers#apikey after logging in - the API key
(secret) and the client id (not secret, needed by the REST convert endpoints). The key can live in 1Password as an `op://` reference.

### Team members

A Heyzine API key belongs to one account, not to a person. The key is 40 hex characters,
a dot, then the account's 16 character client id, so the part after the dot says which
account a key opens. There is no team parameter in the API.

- A team member who generates a key while their own personal space is selected gets a
  key for that space. `heyzine whoami` then shows a handful of flipbooks, or none,
  instead of the team's. Compare the part after the dot with the team account's client
  id before configuring anything.
- To work in the team's account an operator needs the team account's key and client id.
  The dashboard switches accounts (`/admin?team=<n>`) and the developers page appears to
  follow that selection, so selecting the team first and then opening
  https://heyzine.com/developers#apikey should show the team's pair. This is NOT
  verified; if it shows the personal pair, get the values from the account owner.
- Never press the reset keys button while the team account is selected. Heyzine
  disconnects every app authorised on the account, which breaks every other operator's
  configuration at once.
- Each operator still keeps the key in their own config file or password manager. It is
  one shared secret per account, so treat a leak as a reason to rotate for everyone.

## 2. Choose how the key is supplied

The CLI and the MCP bridge share one resolver. First configured method wins; a
configured method that fails is a loud error, never a silent fallthrough.

1. Plugin config field "Heyzine API Key" (stored in the OS keychain by Claude Code).
2. Config file `~/.config/heyzine-plugin/config.toml`, the unattended default -
   1Password sessions expire after ten minutes and need a person present, the file does
   not. Create it with `chmod 600`:

   ```toml
   api_key = "..."
   client_id = "..."
   public_host = "docs.aflip.in"
   template_id = ""
   url_domain = ""
   staging_folder_id = ""
   default_tags = "published-by:heyzine-plugin"
   ```

3. 1Password reference - `op_ref = "op://Vault/Item/field"` in the file (plus
   `op_account = "yourteam.1password.com"` when op is signed in to several accounts), or
   the plugin fields "1Password Secret Reference" and "1Password Account". Read via the
   op CLI at server start with a 25 second timeout; needs 1Password unlocked.
4. Nothing configured - the MCP bridge starts mcp-remote in OAuth mode and a browser
   sign-in opens. The OAuth token works on MCP only, so the CLI stays unavailable; use
   this for a personal account without a stored key, not for unattended work.

Never paste the key into chat. The launcher writes it to a 0600 header file in the
plugin data dir and never puts it in a command line.

## 3. Verify

Run `heyzine whoami --json`. It reports the key source, the flipbook count, whether
bookshelf listing works (a plan probe), whether the client id is configured, the public
host, the template, the staging folder and the data dir. It proves the key works and
what the probes observed; it does not name the plan. A missing client id shows as
`client_id_configured: false` and every convert will fail with exit 2 until it is added.

## 4. Public host

Set `public_host` to your white-label host. The API reports heyzine.com links; the
plugin rewrites share URLs onto this host (same short id, verified to serve). Confirm
once by opening `https://<host>/<short>.html` for any existing flipbook from
`heyzine list`.

## 5. Template

Pick the flipbook whose design new ones should copy (logo, page effect, background,
controls). `heyzine list --json` shows ids; put the full id in `template_id`. The
template copies design only, never access lists.

## 6. Drive staging folder

Local documents are staged on Google Drive so Heyzine can fetch them. Use the Scribe
plugin's Drive tools to create or locate a Shared Drive folder named "the staging folder",
share it anyone-with-link (reader), and put its folder id in `staging_folder_id`. Files
in it are permanent sources - a revision overwrites the file in place so the URL, and
therefore the flipbook id, stays the same.

## 7. First conversion check

`heyzine drive-url <file id>` prints the direct download URL for a staged file. The
accepted form is recorded in dev-docs/api-audit-2026-09-15.md (live spike); if Heyzine
ever refuses it, the fallback order is the `--form uc` variant, then hosting the file on
an R2 bucket or the academy media library.

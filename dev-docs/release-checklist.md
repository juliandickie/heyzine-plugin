# Release checklist

1. `npm test` green (`node --test test/*.test.js`), `claude plugin validate .` passes.
2. Re-run the install hook cold against the real data dir (`rm -rf` the data dir's
   `node_modules` first) and confirm one install line then silence on the second run.
3. Bump the four version copies together - `.claude-plugin/plugin.json`,
   `.claude-plugin/marketplace.json`, `package.json`, `CHANGELOG.md` (move the unreleased
   section under the version and date).
4. Commit on main. Pushing, tagging (`vX.Y.Z`, annotated), and listing in the outfit and
   ai-loadout catalogs (both marketplace.json files and both README tables, same order)
   are separate actions each needing the operator's go.
5. After a listing change, reinstall locally and confirm the cache version, then run
   `heyzine whoami` from a terminal session and confirm the MCP tools appear (desktop
   sessions may not spawn plugin servers).
6. Release smoke - one real document through `/heyzine:publish` on the production key,
   both URLs opened and looked at, register read back, recorded in
   `dev-docs/smoke-run-<date>.md`.

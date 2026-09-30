# Team member access - 2026-09-25

Raised when a team member of a Premium account generated a key and the plugin saw only their personal Free space.

- Key shape (observed on the reference account). The API key is 40 hex characters, a dot, then the account's 16 hex client id. The client id is therefore readable from the key, so a key can be matched to an account without calling the API, and a team member can check a key against the account's client id (not secret) before configuring it.
- No REST parameter, header or endpoint selects a team. `flipbook-list` answers from the account the key belongs to.
- The dashboard switches accounts by URL (`/admin?team=<n>`). The developers page is rendered with the same server-side team context as the dashboard (`common.teamUpgrade` block, "The account is managed by your team" copy, `/join-team` flow), so it probably shows the key and client id of whichever account is selected. NOT VERIFIED yet - needs a team member's login. If it holds, a member gets the team key by selecting the team and then opening `/developers#apikey`.
- Risk. Heyzine documents that resetting the keys disconnects every app authorized on the account. If the developers page is team-scoped, a member pressing reset while the team is selected would break every other operator's config.
- Gap. The setup skill says nothing about team members; add a section once the team-scoped developers page is confirmed. (0.1.5 added the section with the team-scoped developers page marked as unverified.)

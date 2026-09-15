# Heyzine plans and feature gates

Captured 2026-09-15. Source - the pricing section of https://heyzine.com/#product (raw HTML feature lists including tooltip text), the developers page, and the live MCP tool descriptions. the reference account is on the **Premium** plan (Julian, 2026-09-15), confirmed by the account listing 8 bookshelves.

Prices are set dynamically on the page and changed between two fetches the same day (USD 84 / 156 / 324 yearly in the morning fetch, 59 / 108 / 228 in the afternoon fetch). Treat prices as indicative and the feature gates as the useful part.

## Plans

| Plan | Yearly (USD) | Monthly (USD) | Headline |
|---|---|---|---|
| Free | 0 | 0 | 5 flipbooks (oldest removed past the cap), unlimited pages, no ads, API access, 1 GB storage, 1 account user, password protection (unlimited usernames and passwords) |
| Standard | 59 (5 per month) | not offered | Unlimited flipbooks and updates, no watermarks, API access, 10 GB storage (about 2000 typical 5 MB PDFs), 3 account users, white branding (remove the Heyzine logo, use your own), password protection, download offline flipbooks, basic support |
| Professional | 108 (9 per month) | 14 | Everything in Standard, 20 GB storage, 10 account users, reader statistics, Google Analytics integration, lead generation forms, custom flipbook URL and subdomain (aflip.in and hflip.co subdomains, address like https://mycompany.aflip.in/anything), domains restriction (choose which websites can embed), basic support |
| Premium | 228 (19 per month) | 29 | Everything in Professional, 40 GB storage, 20 account users, digital bookshelf, custom flipbook URL and DNS domain (bring your own domain, address like https://anything.mycompany.com/anything), advanced password protection (one-time access emails so a password cannot be shared), priority support |

Add-ons - extra flipbook packs (10, 15, 25, 50) for accounts that need more than their allowance.

## Feature matrix

| Feature | Free | Standard | Professional | Premium |
|---|---|---|---|---|
| Flipbooks | 5 | Unlimited | Unlimited | Unlimited |
| Pages per flipbook | Unlimited | Unlimited | Unlimited | Unlimited |
| Ads | None | None | None | None |
| Watermarks | Heyzine branding | None | None | None |
| API access | Yes | Yes | Yes | Yes |
| Storage | 1 GB | 10 GB | 20 GB | 40 GB |
| Account users | 1 | 3 | 10 | 20 |
| White branding, own logo | No | Yes | Yes | Yes |
| Password protection (user and password lists) | Yes | Yes | Yes | Yes |
| Download offline flipbooks | No | Yes | Yes | Yes |
| Reader statistics | No | No | Yes | Yes |
| Google Analytics integration | No | No | Yes | Yes |
| Lead generation forms (leads webhook) | No | No | Yes | Yes |
| Custom flipbook URL path | No | No | Yes | Yes |
| Custom subdomain (aflip.in, hflip.co) | No | No | Yes | Yes |
| Domains restriction for embeds | No | No | Yes | Yes |
| Digital bookshelf | No | No | No | Yes |
| Custom DNS domain (own domain) | No | No | No | Yes |
| Advanced password protection (one-time access emails) | No | No | No | Yes |
| Support | None | Basic | Basic | Priority |

## API and MCP gates that map onto the plans

| Operation | Gate | What the server says when refused |
|---|---|---|
| `logo` on convert or design | Standard or above | plan message from the server |
| `url_path`, `url_domain` on convert or design | Professional or above (path and subdomain), Premium for an own DNS domain | "Requires a plan with custom URLs" style message |
| `bookshelf-list`, `bookshelf-flipbooks`, `bookshelf-add`, `bookshelf-remove`, `bookshelf-social` | Premium | plan message; "Bookshelf tools require a plan that includes bookshelves" |
| `access-add` with `email_link`, `email_code`, `send_code` | Premium (advanced password protection) | plan message; the skill must not switch to another access type silently |
| `access-add` with `user_pass`, `google`, `pass_only`, `otp` | Any plan | none |
| Leads webhook | Professional or above (lead forms) | configured in the account UI only |
| `flipbook-replace` (replace the source PDF in place) | Paid plan AND the account enabled by support@heyzine.com | `{"success":false,"code":403,"msg":"Private API endpoint. Contact support@heyzine.com for more details."}` - observed on the the reference account account 2026-09-15, so the reference account is NOT enabled; use convert with `replace: true` on the same URL instead |
| Free plan flipbook cap | Free only | the oldest publications are removed past five |

## How the plugin uses this

- `heyzine whoami` probes the gates that can be probed read-only (bookshelf listing) and reports them as observed facts, not as a plan name.
- The `heyzine-api` skill carries this table so a request that needs a gated feature is answered with the gate before any call is made, and a server plan error is reported verbatim with the plan that would unlock it.
- The default plan assumption for the reference account is Premium (everything available except `flipbook-replace`). For any other account the skills assume nothing and rely on the probe plus server messages.

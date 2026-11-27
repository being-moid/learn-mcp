# Step 04 notes: Auth with Better Auth, tenants and roles

**Live MCP URL:** https://learn-mcp-step-04.stockroom-mms.workers.dev/mcp

**Defence video:** _TODO: link_

The step 3 notes server, now behind sign-in. Better Auth (on D1) is the OAuth server Claude and ChatGPT connect through. Every customer gets a tenant and a company; each company has Owner, Admin and Member roles plus any it creates, and notes belong to one person in one company.

## What I built and why

> _TODO, in my own words (3 to 6 bullets). Prompts:_
> - _Why the company comes only from the token, never from a tool argument._
> - _Why membership and role are checked on every request, not just at sign-in._
> - _Why invitees only choose a password, and why the link's token can't be used by the inviter._
> - _What the outbox is for, and why it's in D1 now and copied to Neon in step 05._
> - _Why staging, the end-to-end tests and cleanup exist._

## What each client showed

Checked on 27 November 2026 against the live server.

- **Claude** (`claude.png`): saved "Q4 targets" with `create_note`; the panel shows the request and the server's response (the note's ID and creation time). `claude-members.png`: "Who is in my company" called `list_company_members` and listed the Owner and a Member.
- **ChatGPT** (`chatgpt.png`): "show me notes" called `list_notes` and returned the note saved from Claude, because both apps signed in as the same person in the same company. `chatgpt-members.png`: the same two members.
- **The invitation flow** worked end to end on production: the Member was invited with `invite_member`, got the email, chose a password on the invitation page, and appeared with the Member role.
- **One thing ChatGPT got wrong:** asked "What are roles?", it answered from general knowledge without calling `list_roles`, and described permissions the server doesn't have. Asking "List my company's roles" makes it call the tool.

## Tenant isolation

> _TODO, in my own words: one isolation decision and how it's enforced. A good one: notes are per person, so a colleague in the same company can't read my notes (KV keys start with `org:<company>:user:<user>:`, both taken from the verified token). Or: one company's Owner can't touch another company's members or roles, because every role query is built for the caller's company only._

## Security review (README prompt 8)

| Area | Finding | Fix |
| --- | --- | --- |
| Members and roles | Better Auth's own organization endpoints (`update-member-role`, `remove-member`, `invite-member`, `get-full-organization`, …) accepted a signed-in browser session and skipped our guardrails: an Admin could make someone an Owner, and a Member could read every member's email. | Only the five endpoints the pages need stay open (`list`, `set-active`, `get-invitation`, `accept-invitation`, `reject-invitation`); the rest answer 403. Removing someone is now a guarded tool, `remove_member` (new `members:remove` permission). |
| CORS | Every response said `Access-Control-Allow-Origin: *`. The Origin check already refused other sites, so the risk was small. | CORS now names the caller's own origin, only after the Origin check accepts it (localhost tools and this site); calls without an Origin get no CORS headers; credentials are never allowed cross-origin. |
| Consent page | It showed only the `client_id`, which is a random string for a self-registered client, so an attacker's app could look like any other. | It now shows the app's verified address (for apps identified by a metadata URL, as Claude and ChatGPT are) or marks it unverified, and where the access is sent. |
| Redirect URIs | Checked on staging: registration refuses `http://` (except loopback), `javascript:` and fragments; authorize accepts only the exact registered URI (another host, `../` or an added query go to our error page). | Nothing to fix. |
| Token validation | Signature, issuer, audience (our `/mcp`) and expiry are checked by `requireMcpAuth`; tests cover a forged token, a token for another server, and a removed member with a valid token (403 on the next call). | Nothing to fix. |
| Secrets | The auth secret and Resend key live in the Cloudflare Secrets Store; the Resend key never appears in errors; a password once reached the request logs through a GET form while a page script was broken. | Forms always POST; page scripts are tested to parse; invitation tokens travel after `#`, so they never reach the server's logs. |

## Problems I hit

> _TODO, in my own words. Candidates: the page script that broke because a template string ate a regex's backslashes (and put a password in a URL); Resend's "Illegal invocation"; Cloudflare's CPU limit (Error 1102) found by the end-to-end tests._

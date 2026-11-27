# Step 04 plan: sign-in, tenants, organizations, per-org roles and an outbox

Working plan for `step-04-auth/`. It goes beyond the bootcamp README (tenants above organizations, per-organization roles, role-management tools and a D1 outbox), so NOTES.md must say these were my design choices.

## Goal

The step 03 notes server, now behind OAuth sign-in from Claude and ChatGPT:

- Every user signs up on our own `/sign-in` page when they first connect.
- A **tenant** (a customer account) owns one or more **organizations**. The organization is the data-isolation boundary.
- Each organization names its own **roles**, built from a fixed list of **permissions**. Every tool, resource and prompt declares the permission it needs.
- Notes are per user inside an organization: `org:<orgId>:user:<userId>:note:<noteId>`.
- Every change to users, tenants, organizations, members and roles is written to a D1 **outbox**, for Neon to copy in step 05.

## Decisions (agreed)

| Topic | Decision |
| --- | --- |
| Isolation boundary | Per **organization**. Tenant admins manage their orgs and see members across them, but never read notes across orgs. |
| Auth store | **D1** stays the source of truth. Step 05 copies it to Neon through the outbox; nothing moves. |
| Roles | **Our own D1 tables**, names chosen per organization; permissions fixed in code. |
| Admin interface | **Tools in the chat**; sensible defaults seeded for every new organization. No admin web UI. |
| Sign-in | Email and password. |
| Company in the token | Chosen on the consent page (picker shown only if the user has more than one organization). |
| Secret | `BETTER_AUTH_SECRET_STEP_04` in the Cloudflare Secrets Store (option A after stage 0), created by me with the interactive prompt (never pasted into chat or terminal history). Tests use a test-only `AUTH_SECRET_FOR_TESTS` binding defined only in `vitest.config.ts`; `wrangler dev` uses a local store secret. Read by `src/infrastructure/auth/auth-secret.ts`. |
| Client registration | CIMD preferred; DCR enabled as fallback, rate-limited. |
| SSO | Skipped until the core works. |

## Hierarchy

```
tenant          e.g. "Karachi Foods Group"
 └─ organization  e.g. "Karachi branch"        ← isolation boundary (orgId everywhere)
     └─ member      a user with one role defined by that organization
```

A user can belong to several organizations, even in different tenants. The token carries the one organization chosen at connect time; the tenant is looked up from that organization in D1 on every request.

## Permissions (fixed, in code: `src/domain/permissions.ts`)

| Permission | Used by |
| --- | --- |
| `notes:read` | `list_notes`, `get_note`, `note://{id}` resources, `summarize_notes` |
| `notes:write` | `create_note` |
| `notes:delete` | `delete_note` |
| `members:read` | `list_company_members`, `list_roles` |
| `members:invite` | `invite_member` |
| `roles:manage` | `create_role`, `set_role_permissions`, `assign_member_role` |

## Default roles, seeded for every new organization

| Built-in role (renamable) | Permissions | Given to |
| --- | --- | --- |
| Owner | all | the organization's creator |
| Admin | all except removing the last Owner | assigned by an Owner |
| Member | `notes:read`, `notes:write`, `notes:delete` | everyone invited, by default |

Guardrails, enforced in code and tested:

1. You can't grant a permission you don't hold.
2. An organization always keeps at least one member with the Owner role.
3. The built-in Owner role can't lose permissions or be deleted.
4. Roles and members are only ever read or changed within the caller's own organization.

## D1 schema

Better Auth's tables (generated): `user`, `session`, `account`, `verification`, `jwks`, its OAuth client, consent and token tables, and the organization plugin's `organization` (plus a `tenant_id` field), `member`, `invitation`.

Ours (migration files in `migrations/`):

```sql
CREATE TABLE tenant (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE tenant_admin (
  tenant_id TEXT NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  level     TEXT NOT NULL CHECK (level IN ('owner', 'admin')),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE org_role (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  builtin         TEXT CHECK (builtin IN ('owner', 'admin', 'member')),  -- NULL for custom roles
  created_at      TEXT NOT NULL,
  UNIQUE (organization_id, name)
);

CREATE TABLE org_role_permission (
  role_id    TEXT NOT NULL REFERENCES org_role(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE outbox (                        -- an ordered log, never updated or deleted by the relay
  seq            INTEGER PRIMARY KEY AUTOINCREMENT,  -- delivery order
  id             TEXT NOT NULL UNIQUE,        -- event id, the consumer's / inbox's idempotency key
  aggregate_type TEXT NOT NULL,               -- user | tenant | organization | member | invitation | role ...
  aggregate_id   TEXT NOT NULL,
  event_type     TEXT NOT NULL,               -- e.g. user.created, member.role_changed
  payload        TEXT NOT NULL,               -- JSON: ids, names, email, role; never secrets
  occurred_at    TEXT NOT NULL
);

CREATE TABLE outbox_consumer (                -- each consumer's own position in the log
  name       TEXT PRIMARY KEY,                -- e.g. invitation-email; neon-inbox in step 05
  last_seq   INTEGER NOT NULL DEFAULT 0,
  attempts   INTEGER NOT NULL DEFAULT 0,      -- failures at the next event
  last_error TEXT,
  failed_at  TEXT,                            -- set after 10 failures: stopped until a person resets it
  updated_at TEXT NOT NULL
);
```

`member.role` stores an `org_role.id`.

### Outbox writes

- **First choice: SQLite triggers** (`AFTER INSERT/UPDATE/DELETE`) on `user`, `tenant`, `tenant_admin`, `organization`, `member`, `org_role` and `org_role_permission`, so each event is written in the same transaction as the change, whatever code made it.
- Cloudflare's docs don't say whether D1 supports triggers, so **stage 0 verifies it locally and remotely**.
- **Fallback** if triggers don't work: write outbox rows in the same `db.batch()` as our own table changes (batches are transactional), and use Better Auth's `after` hooks for its tables, with a reconcile job for the gap. Decide with the user before falling back.
- Payloads carry only what other databases need. Explicitly excluded: password hashes, session tokens, OAuth secrets, verification codes.
- **Per-consumer positions, not a `published_at` flag:** each consumer keeps its own cursor, so adding a consumer later (the Neon inbox in step 05) can read the whole history from the start, and one consumer failing never holds up another.
- The relay ships in step 04 (stage 6) with one consumer, the invitation email. Step 05 adds a consumer that copies events into Neon `inbox` tables (`INSERT … ON CONFLICT (event_id) DO NOTHING`).

## Request flow

```
Claude / ChatGPT
  │ 1. POST /mcp (no token)  → 401, WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource/mcp"
  │ 2. GET protected-resource metadata → authorization_servers: [our Worker]
  │ 3. GET /.well-known/oauth-authorization-server → endpoints, CIMD supported, S256
  │ 4. /api/auth/oauth2/authorize → /sign-in (sign in or create account) → /consent (pick organization)
  │ 5. /api/auth/oauth2/token → JWT access token, aud = our /mcp URL, org claim
  ▼
POST /mcp + Bearer token
  guard(): route, Host/Origin, CORS
  auth:    verify JWT (JWKS signature, issuer, audience, expiry)
  tenant:  userId = sub, orgId = org claim
           D1 lookup now: member row + role + permissions + tenant_id   (removed → 403; demoted → fewer permissions)
  handler: buildServices(tenant) → createServer(services) → registers only tools/resources/prompts the role permits
```

The `AuthProvider` returns a `Principal`; `index.ts` passes it to the MCP handler as `authInfo`, and the per-request factory hands it to the composition root, which builds repositories already scoped to it (for example the KV key prefix `org:<orgId>:user:<userId>:note:`). Services and tools never see an unscoped store, and the principal never comes from a tool argument. A request that reaches the handler without a principal fails closed.

## Architecture

Layered, with dependencies pointing inward:

```
presentation      mcp/ (tools, resources, prompts) and http/ (routes, guard, auth pages)
      │  calls
application       services: use cases and business rules
      │  depends on interfaces (ports) defined in…
domain            entities, permissions, errors, repository interfaces; no Cloudflare, no SQL
      ▲  implemented by
infrastructure    KV, D1, Durable Objects, Better Auth: the only code that touches storage
```

- **Single responsibility:** a tool shapes input and output for the model, a service enforces rules, a repository stores data.
- **Open/closed:** a new tool, rule or permission is a new file or entry, not edits across layers.
- **Liskov substitution:** any implementation of a port can replace another (D1 today, Neon in step 05, in-memory fakes in unit tests).
- **Interface segregation:** narrow ports per aggregate (`NoteRepository`, `RoleRepository`, `MembershipReader`, `TenantRepository`, `OutboxWriter`, `ChangeNotifier`, `IdentityProvider`), never one `Database`.
- **Dependency inversion:** services depend on ports. `src/composition.ts` (the composition root) builds each request's concrete repositories and services by hand; no DI container.
- **Swappable backends, one class each:** two abstract-factory ports cover whole layers. `RepositoryFactory` hands out every repository for a `Principal` (today `KvRepositoryFactory`; later D1 or Neon; `InMemoryRepositoryFactory` in tests). `AuthProvider` authenticates `/mcp` requests and serves the provider's own routes (today `AnonymousAuthProvider`; stage 1 `BetterAuthProvider`). Switching either for the whole codebase is one line in `selectRepositories()` or `selectAuthProvider()`.
- **Contract tests:** every implementation of a repository port runs the same shared suite (`test/contracts/`), so a new backend is proven to behave like the old one before it's swapped in.
- **Repositories are per aggregate**, and every method is scoped by the tenant context it was built with. Master-detail lives inside one aggregate: a role and its permissions (and its outbox event) are written in one `db.batch()`, which D1 runs as a transaction.
- **Deliberately not used:** a generic `Repository<T>` (a generic `findAll` is how cross-tenant leaks happen), class hierarchies, an ORM, a DI container.
- **Better Auth owns the writes to its own tables** (users, organizations, members, invitations). Services reach it through the `IdentityProvider` port; our repositories only read those tables.

## Files

```
src/
  index.ts                                   Worker entry: guard, auth routes, then /mcp with the caller's Principal; runs the outbox relay (cron + after POSTs)
  composition.ts                             composition root: selectAuthProvider(), selectRepositories(), selectEventBus(), selectOutboxRelay(), buildServices()

  domain/                                    pure TypeScript: no Cloudflare imports, no SQL
    entities/
      note.ts                                Note, NoteSummary, NotePage, NewNote, categories
      principal.ts                           who is calling: anonymous, or user + organization
      tenant.ts                              Tenant, NewUser
      membership.ts                          a member's current role and permissions (can())
      role.ts                                a role an organization defines
      outbox-event.ts                        one recorded change, as the relay delivers it
    ports/
      persistence/
        repository-factory.ts                RepositoryFactory: every repository, scoped to a Principal
        note-repository.ts                   NoteRepository
        role-repository.ts                   RoleRepository (one organization per instance)
        membership-reader.ts                 MembershipReader
        tenant-repository.ts                 TenantRepository (tenant + owner + organization link + roles, atomically)
      auth/
        auth-provider.ts                     AuthProvider: authenticate /mcp, serve its own routes
        identity-provider.ts                 IdentityProvider: create organizations through the auth library
      notifications/
        change-notifier.ts                   ChangeNotifier
        email-sender.ts                      EmailSender (category: invitation or notification)
      outbox/
        outbox-store.ts                      OutboxStore: the log and each consumer's position
        outbox-consumer.ts                   OutboxConsumer: something that reacts to events (idempotent)
    permissions.ts                           the fixed permission list and the default roles
    errors.ts                                ForbiddenError, GuardrailError, NotFoundError

  application/
    services/                                use cases and business rules
      notes-service.ts                       list, get, create, delete; announces resource-list changes
      access-service.ts                      is the caller still a member? (asked on every request)
      roles-service.ts                       list, create, set permissions, assign; the four guardrails
      members-service.ts                     list members, invite by email (the outbox sends the email)
      account-emails.ts                      confirmation and invitation emails
      onboarding-service.ts                  sign-up -> tenant + organization + default roles + Owner (idempotent)
      organization-choice-service.ts         default organization; must the user choose?
      outbox-relay.ts                        delivers outbox events to each consumer, in order, with retries
      invitation-email-consumer.ts           emails each new invitation from the outbox

  infrastructure/                            the only code that touches storage, auth libraries or Cloudflare
    persistence/
      kv/kv-repository-factory.ts            RepositoryFactory on Workers KV (decides key prefixes)
      kv/kv-note-repository.ts               NoteRepository on Workers KV
      d1/d1-membership-reader.ts             MembershipReader on Better Auth's member and organization tables
      d1/d1-tenant-repository.ts             TenantRepository on D1 (one batch)
      d1/d1-role-repository.ts               RoleRepository on D1
      d1/role-sql.ts                         the effective-role query, shared
      d1/d1-invitation-repository.ts         invitations in Better Auth's table (and their status)
      d1/d1-outbox-store.ts                  OutboxStore on D1
    email/
      resend-email-sender.ts                 EmailSender on Resend
      recording-email-sender.ts              EmailSender for tests
    auth/
      anonymous-auth-provider.ts             today: everyone is the anonymous principal
      better-auth-provider.ts                AuthProvider on Better Auth: serves /api/auth/* and discovery (stage 2: verifies tokens)
      better-auth.ts                         betterAuth({ database: env.AUTH_DB, plugins: [jwt(), organization(), mcp(), cimd()] })
      cimd-fetch.ts                          safe fetch transport for Client ID Metadata Documents
      auth-secret.ts                         reads BETTER_AUTH_SECRET from the Secrets Store (test-only override)
      better-auth-identity-provider.ts       IdentityProvider on Better Auth's API
    context/
      request-context.ts                     the current caller (AsyncLocalStorage), for the event bus
    notifications/
      hub.ts                                 NotificationHub Durable Object (one per caller)
      event-bus.ts                           ServerEventBus backed by the hub
      mcp-change-notifier.ts                 ChangeNotifier on the MCP handler's notify

  presentation/
    http/guard.ts                            Host/Origin checks and CORS
    http/auth-pages.ts                       /sign-in, /select-organization, /consent and /accept-invitation pages
    mcp/auth-info.ts                         carries the Principal through the SDK's authInfo (fails closed)
    mcp/handler.ts                           the module-level MCP handler (its event bus comes from selectEventBus())
    mcp/server.ts                            per-request McpServer factory
    mcp/tool-kit.ts                          defineTool and shared tool helpers
    mcp/tools/index.ts                       the full tools list + registerTools
    mcp/tools/notes.ts                       list_notes, get_note, create_note, delete_note
    mcp/tools/admin.ts                       members and roles tools
    mcp/resources/notes.ts                   note://{id}
    mcp/prompts/summarize-notes.ts           summarize_notes

migrations/
  0001_better_auth.sql                       generated by Better Auth's migration compiler (see the file header)
  0002_tenancy_and_roles.sql                 tenant, tenant_admin, org_role, org_role_permission
  0003_member_roles.sql                      org_member_role: which of its organization's roles each member has
  0004_outbox.sql                            outbox log, consumer positions, 25 triggers

test/
  contracts/                                 shared suites every implementation of a port must pass
  fakes/                                     in-memory implementations of the ports
  unit/                                      application/services, infrastructure, presentation: no bindings
  integration/                               through the real Worker and bindings: http/, mcp/, notifications/, infrastructure/
  integration/helpers/                       stateless MCP requests, subscriptions/listen streams
```

Config: `wrangler.jsonc` (D1 `AUTH_DB`, own KV namespace, Secrets Store bindings, migrations dir, a once-a-minute Cron Trigger, `PUBLIC_URL` and the two from-addresses) and `.dev.vars.example` (placeholder for the local test secret).

New tools: `list_company_members`, `invite_member`, `list_roles`, `create_role`, `set_role_permissions`, `assign_member_role`. Role and membership changes are marked `destructiveHint`.

## Stage 0 findings (27 November 2026)

Checked with throwaway tests and scratch SQL, since removed. Resources created for step 04: D1 `learn-mcp-auth-step-04` (bound as `AUTH_DB`) and KV namespace `NOTES_STEP_04` (bound as `NOTES`).

| Question | Answer |
| --- | --- |
| Does D1 support triggers? | **Yes, locally and on the remote database.** `AFTER INSERT` and `AFTER UPDATE OF` triggers wrote `user.created` and `user.updated` rows, with payloads built by `json_object()` in SQL. |
| Is a trigger's outbox row atomic with its change? | **Yes.** When a `db.batch()` failed on a later statement, the outbox row a trigger wrote for an earlier statement in the batch was rolled back too. The outbox design stands as planned. |
| Does Better Auth run in the Vitest Workers runtime on local D1? | **Yes.** `getMigrations(auth.options).runMigrations()` created 15 tables (`user`, `session`, `account`, `verification`, `jwks`, `organization`, `member`, `invitation`, `oauthClient`, `oauthResource`, `oauthClientResource`, `oauthRefreshToken`, `oauthAccessToken`, `oauthConsent`, `oauthClientAssertion`). `signUpEmail` and server-side `createOrganization({ userId })` worked; the creator's role is `owner`. |
| Discovery | `mcp()` serves protected-resource metadata at `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp` with `resource` = the `/mcp` URL and `authorization_servers: [<base>/api/auth]`. The issuer is `<base>/api/auth`, so auth-server metadata is at `/.well-known/oauth-authorization-server/api/auth` (the first URL MCP clients try for a path issuer); the root path returns 404, which is correct. `scopes_supported` includes `offline_access`, so Claude will ask for refresh tokens. |
| How does the chosen organization get into the token? | Through the OAuth provider options: `postLogin.shouldRedirect` + `postLogin.page` send a user with more than one organization to our picker; `postLogin.consentReferenceId` returns the chosen organization ID (consent is stored per organization); `customAccessTokenClaims({ referenceId })` writes it into the JWT as a namespaced claim, which `BetterAuthProvider` reads into `Principal.organizationId`. |
| Token verification | `requireMcpAuth(auth, handler, { resource })` from `@better-auth/mcp` checks signature (from the auth instance's own keys, no HTTP call), issuer, audience and expiry, and answers 401 with the `resource_metadata` challenge. |
| CIMD on Workers | `cimd()` needs an injected metadata-fetch transport on Workers (no redirects, no private addresses). To build in stage 1. |
| Secrets Store locally | **Gap.** The local Secrets Store is empty, so `env.BETTER_AUTH_SECRET.get()` fails in tests and `wrangler dev` ("Secret not found"). Miniflare can seed it through an admin API that the Vitest pool doesn't expose to tests. Decision needed (see below). |
| Packages | `better-auth`, `@better-auth/mcp`, `@better-auth/cimd`, `@better-auth/oauth-provider` installed at exactly 1.7.28. `agents` is no longer imported and can be removed. |

**Secret decision: A, keep the Secrets Store.** Built and tested: `readAuthSecret()` in `src/infrastructure/auth/auth-secret.ts` reads the store, or the Vitest-only `AUTH_SECRET_FOR_TESTS` binding when present, refuses values under 32 characters, and explains how to create the secret when it's missing.

## Build stages (each ends with passing tests)

- **Done:** the code is organized in these layers. Notes go tool -> `NotesService` -> `NoteRepository` (from `RepositoryFactory`, scoped to the `Principal`) -> KV. `AnonymousAuthProvider` stands in for auth until stage 1. 48 tests: unit tests with in-memory fakes, the `NoteRepository` contract against the fake and KV, KV isolation between principals, and the earlier integration tests.
0. ✅ **Checks before building:** done; see "Stage 0 findings".
1. ✅ **D1 and Better Auth:** done.
   - `migrations/0001_better_auth.sql`: 16 tables (Better Auth's 15 plus `rateLimit`), generated by Better Auth's own migration compiler inside the Workers runtime; applied locally with `wrangler d1 migrations apply`, and before every test run (`test/setup/apply-migrations.ts`).
   - `src/infrastructure/auth/better-auth.ts`: email + password (minimum 10 characters), rate limit stored in D1, `jwt()`, `organization()` with a `tenantId` field clients can't set, `mcp()` bound to `/mcp` with DCR as fallback, `cimd()` with the `mcp-2026-07-28` profile.
   - `src/infrastructure/auth/cimd-fetch.ts`: the Workers transport for client metadata (HTTPS only, public host names only, no IP literals or local names, no redirects, 5 s timeout, 64 KB cap).
   - `src/infrastructure/auth/better-auth-provider.ts`: `handleRoute` serves `/api/auth/*` and `/.well-known/*`; `authenticate` still returns anonymous until stage 2. Switched on in `selectAuthProvider()`.
   - `src/presentation/http/auth-pages.ts`: `/sign-in` (sign in or create account) and `/consent`, routed by `index.ts`; nonce-based CSP, `frame-ancestors 'none'`, `no-referrer`, `no-store`, values shown with `textContent`.
   - Tests (73 in all): discovery against Claude's requirements, sign-up and sign-in with the D1 row checked, page security headers, CIMD transport refusals.
   - To revisit in stage 8: our CORS wrapper adds `Access-Control-Allow-Origin: *` to Better Auth's responses too (fine for the same-origin pages and public discovery documents, but review for the token and registration endpoints).
2. ✅ **Protect `/mcp`:** done.
   - The chosen organization goes into the token: `postLogin.consentReferenceId` = the session's active organization, written by `customAccessTokenClaims` as `https://stockroom.example/organization_id`. (`postLogin.shouldRedirect` returns false until stage 3's picker.)
   - `BetterAuthProvider.authenticate` verifies the token with Better Auth's `requireMcpAuth` (signature, issuer, audience = our `/mcp`, expiry) and turns it into a user `Principal`; Better Auth's 401 carries the `resource_metadata` challenge. A token with no organization claim gets 403 `no_organization`.
   - Membership is re-checked on every request: `MembershipReader` port, `D1MembershipReader` (reads Better Auth's `member` and `organization` tables), `AccessService` (application). A removed member gets 403 `not_a_member` on the next call, even with an unexpired token.
   - Better Auth reads the caller's IP only from `cf-connecting-ip` (set by Cloudflare, can't be faked), instead of the default `x-forwarded-for`, so the rate limit can't be dodged.
   - Tests (84 in all): `test/integration/helpers/oauth.ts` runs the real flow (DCR, sign-up, organization, authorize with PKCE S256 and `resource`, consent, token), and every MCP test now uses a genuine token. New tests: no token -> 401 with `resource_metadata`; a foreign token -> 401; a token for another server -> 401 (audience); a removed member -> 403; no organization -> 403; Alice's note invisible to Bob through tools and resources; rate limit holds with faked `x-forwarded-for`; `AccessService` unit tests.
3. ✅ **Tenancy and onboarding:** done.
   - `migrations/0002_tenancy_and_roles.sql`: `tenant`, `tenant_admin`, `org_role` (names unique per organization, one row per built-in role), `org_role_permission`. The outbox moves to its own migration in stage 6.
   - Domain: `permissions.ts` (the fixed list and the three default roles), `Tenant`, `IdentityProvider` (creates organizations through Better Auth), `TenantRepository`; `MembershipReader.organizationsOf`.
   - `OnboardingService`: tenant + personal organization (via `IdentityProvider`) + default roles; idempotent, and reuses an existing organization so a half-finished onboarding completes. `OrganizationChoiceService`: default organization, and whether a user must choose.
   - `D1TenantRepository.createTenantForOrganization`: tenant, owner, organization link and roles in one `db.batch()` (all or nothing, tested).
   - Better Auth hooks call an `AuthLifecycle` built in the composition root (infrastructure never imports application): `user.create.after` onboards; `session.create.before` sets the active organization and finishes onboarding if it didn't complete; `postLogin.shouldRedirect` sends users with several organizations to `/select-organization` and, on the way back, insists the active organization is one they belong to.
   - `/select-organization` page: lists the user's organizations, sets the chosen one active, resumes with `/oauth2/continue`.
   - Tests (99 in all): onboarding services with fakes; sign-up creates every row; a new user's session starts on their organization; a brand-new user can use the tools; the picker (not shown with one organization, shown with several, token carries the choice, can't pick someone else's); tenant setup is atomic.
4. ✅ **Per-user notes and per-caller hub:** done.
   - Notes and `note://` resources were already per user (stage 2 tests).
   - The notification hub is now one Durable Object per caller, `org:<orgId>:user:<userId>` (`hubName()` in `infrastructure/notifications/event-bus.ts`). The MCP SDK calls the event bus without the request, so `index.ts` runs each authenticated `/mcp` request inside a request context holding its `Principal` (`infrastructure/context/request-context.ts`, `AsyncLocalStorage`); `subscribe` picks its hub when called, `publish` routes to the caller's hub, and a call with no signed-in caller does nothing.
   - Tests (100 in all): Alice's listener hears her change; a colleague in her organization (added through Better Auth's invitation API) and a user in another organization hear nothing.
   - Observed: Better Auth accepts invitations with no email sender configured, so today an invitee is never told. Stage 5b fixes that.
5. ✅ **Roles, permissions and admin tools:** done.
   - `migrations/0003_member_roles.sql`: `org_member_role` (which of its organization's roles each member has). A member with no row has the built-in role matching Better Auth's `member.role`; assigning a role also updates `member.role` (owner, or admin if the role can manage roles, else member) so Better Auth's own checks agree.
   - Every organization gets its default roles from Better Auth's `afterCreateOrganization` hook, however it was created (onboarding no longer seeds them). A member whose organization has no roles gets no permissions (fails closed).
   - Domain: `Membership` now carries the caller's role and permissions (`can()`), `Role`, `MemberSummary`, `ForbiddenError` / `GuardrailError` / `NotFoundError`, `RoleRepository` (one organization per instance), `MembershipReader.listMembers`.
   - `D1RoleRepository`: every query filtered by its organization; a role and its permissions written in one batch; roles listed Owner, Admin, Member, then custom. Shared effective-role SQL in `role-sql.ts`.
   - `RolesService` (guardrails: can't grant what you don't hold; keep at least one Owner; Owner role can't change; only an Owner makes an Owner) and `MembersService`.
   - The caller's membership is resolved once per request (access check) and carried to the composition root through the SDK's `authInfo` (`Caller`), then into `Services.caller`, `roles`, `members`.
   - Every tool declares `requires`; `defineTool` checks it on every call and turns domain errors into clear tool errors. Tools stay listed for everyone and refuse with the missing permission; resources and the prompt are only registered for callers with `notes:read`.
   - Admin tools (`presentation/mcp/tools/admin.ts`): `list_company_members`, `list_roles`, `create_role`, `set_role_permissions` and `assign_member_role` (both destructive). `invite_member` moves to 5b, with email.
   - Tests (119 in all): `RolesService` guardrails with an in-memory role repository; `MembersService`; through MCP with real tokens: Owner sees members and roles, Member refused the admin tools, a role change applies on the next call with the same token, last Owner protected, another organization's roles unreachable and unchanged, no resources or prompt without `notes:read`, default roles for an organization created directly through Better Auth.
   - For stage 8: Better Auth's own organization endpoints (`/api/auth/organization/update-member-role`, `remove-member`, …) are still reachable with a session cookie and don't apply our guardrails (an Admin could make someone an Owner there). Disable them or guard them with Better Auth's `before…` organization hooks, so every role change goes through `RolesService`.
5b. ✅ **Email, verification and invitations:** done.
   - Email: `EmailSender` port with a category (`invitation` or `notification`); `ResendEmailSender` (Resend's HTTPS API, key read from the Secrets Store `RESEND_API_KEY` only when sending, idempotency key on every message, errors never include the key); `RecordingEmailSender` used only when the Vitest-only `EMAIL_SENDER_FOR_TESTS` is set. From-addresses are config (`wrangler.jsonc` vars): invitations from `verification@moidshams.dev`, all other notifications (including sign-up confirmation) from `donotreply@moidshams.dev`. The domain `moidshams.dev` is verified in Resend (confirmed 27 November 2026).
   - `AccountEmails` (application): the confirmation and invitation emails, with user-supplied names escaped in the HTML and stable idempotency keys.
   - Better Auth: `requireEmailVerification` (sign-in refused until confirmed; signing in sends a fresh link), confirmation sent on sign-up, following the link signs the user in; `requireEmailVerificationOnInvitation`; `sendInvitationEmail`. Sends run in the background (`waitUntil`) so response time can't reveal whether an address has an account.
   - `invite_member` tool (`members:invite`): `MembersService.invite` creates the invitation in Better Auth's `invitation` table (`D1InvitationRepository`, because Better Auth's invite API needs a browser session and MCP calls carry a token), then emails it. Re-inviting reuses the pending invitation; inviting as Admin needs every Admin permission; nobody is invited as Owner; existing members are refused.
   - Pages: `/sign-in` shows "check your email" after creating an account and accepts a safe same-site `next` path; new `/accept-invitation` (shows the invitation, Accept or Decline, asks to sign in first).
   - Tests (134 in all): every test account confirms its email by following the recorded link; sign-in refused before confirming; confirmation email category and link; `AccountEmails` escaping and keys; `ResendEmailSender` request, from-address per category, no key in errors; `MembersService` invite rules; end to end through the Worker: invitation email and accept link, invitee joins as Member, a different email can't accept, an unconfirmed account can't claim the invited address, a Member can't invite.
   - Still sent from the request (in the background); stage 6 moves sending onto the outbox relay.
6. ✅ **Outbox and relay:** done.
   - `migrations/0004_outbox.sql`: the `outbox` log (`seq` order), `outbox_consumer` positions, and 25 triggers on `user`, `organization`, `member`, `invitation`, `tenant`, `tenant_admin`, `org_role`, `org_role_permission` and `org_member_role`. None on `account`, `session`, `verification`, `jwks` or the OAuth tables, so passwords, sessions and tokens never reach it. The migration registers the `invitation-email` consumer at position 0, so no invitation made after it can be missed.
   - Domain: `OutboxEvent`; ports `OutboxStore` (events after a position, register/read a consumer, advance only from the position read, record a failure) and `OutboxConsumer` (`name`, `startFrom` "beginning" or "now", `handles`, `handle`). Infrastructure: `D1OutboxStore`, `D1InvitationStatusReader`.
   - `OutboxRelay` (application): per consumer, in log order, up to 50 events a run; skips event types it doesn't handle; saves its position after each event (a crash repeats at most one, so consumers are idempotent); a failure stops that consumer at that event and is retried next run, and after 10 failures it stops until a person resets it, without holding up other consumers.
   - `InvitationEmailConsumer`: emails `invitation.created` (from `invite_member` or Better Auth), skipping invitations no longer pending or expired; link built from the `PUBLIC_URL` var; idempotency key `invitation:<id>`, so Resend sends a repeat only once. `MembersService.invite` no longer sends email, and Better Auth's `sendInvitationEmail` is gone. Re-inviting sends nothing new.
   - Confirmation emails stay direct (in the background): they carry a sign-in token, which must not be stored in the outbox.
   - Runs from a Cron Trigger every minute (`scheduled`) plus a kick after every POST (`ctx.waitUntil`). Step 12 can move delivery onto Queues.
   - Tests (155 in all): relay with an in-memory store (order, skip, no repeats, "now" vs "beginning", retry, stop after max attempts, one consumer's failure doesn't block another, batch size, concurrent run); the consumer (handles only new invitations, link and key, nothing for gone, accepted or expired invitations); on D1: sign-up writes user, organization and member events, no secret tables or fields in any payload, a failed batch writes no event, `D1OutboxStore` registration, ordering, compare-and-advance and failures; end to end: the invitation email arrives through the relay, re-inviting sends no second email.
6b. ✅ **Join from an invitation with only a password, and responsive pages:** done (from testing the live deploy).
   - The invitation link is `/accept-invitation?id=…#token=…`. The token is an HMAC of the invitation ID keyed by the auth secret (`HmacInvitationLinkTokens`, nothing stored): the inviter sees the ID (`invite_member` returns it) but can't make the token, so they can't use the link to create the invitee's account. It sits after `#`, which browsers never send, so it stays out of request logs; the page removes it from the address bar.
   - Someone without an account only chooses a password (`InvitationSignUpService`, `POST /invitations/preview` and `/invitations/join`). The emailed link proved the address, so: no name/email form, no second confirmation email, and no personal company (they join only the inviting organization). `D1InvitationSignUpRepository.join` writes user (confirmed), password login (Better Auth's hash format), membership with the invited role and the invitation marked accepted in one transaction, each statement re-checking the invitation is still pending, so a link works once. They are then signed in through `AuthProvider.signIn`. Someone who already has an account signs in and accepts, as before.
   - Pages: every button shows a spinner and a progress label and is disabled until done; loading indicators; error, info and success messages; a friendly message when the network fails; forms use `method="post"` (a failed script once made the browser put a password in a URL); no backslashes or regexes in page scripts, with a test that every page script parses.
   - Fixed from the live logs: `ResendEmailSender` called the stored `fetch` as a method ("Illegal invocation"), so no email was sent.
   - Tests (180 in all): token (deterministic, wrong invitation, tampered, other secret); the service (preview, join, one use, wrong token, expired/cancelled/accepted, existing account, password length); end to end: preview, join creates a confirmed member of the inviting company only (no tenant, no second email) who can sign in later, works once, the inviter can't use it without the token, existing accounts sent to sign in, short password doesn't use it up, Better Auth-made invitations keep their role, cross-site POST refused.
6c. ✅ **Staging, end-to-end tests and the deploy pipeline:** done.
   - Staging: `wrangler.jsonc` `env.staging` = Worker `learn-mcp-step-04-staging` with its own D1 (`learn-mcp-auth-step-04-staging`), KV, Durable Objects and auth secret (`BETTER_AUTH_SECRET_STEP_04_STAGING` in the Secrets Store). It never sends email (`EMAIL_DELIVERY: "log"`, `LogEmailSender`, which logs no links).
   - `e2e/` (plain Node over HTTPS, `npm run e2e`): `full.e2e.ts` on staging (two tenants; Owner, Admin, Member, an existing-account member and a custom role; every guardrail; cross-tenant isolation; removal cuts access) and `smoke.e2e.ts` on production (discovery, pages, Owner, notes, a Member invited by real email to Resend's test inbox). Every user, company, tenant and OAuth client is tagged `e2e-<run>-`; test emails are confirmed directly in D1 (nobody reads the test inboxes).
   - `e2e/cleanup.ts`: deletes only the run's rows and its notes in KV, refuses if a test company contains anyone who isn't an e2e user, then checks nothing is left. Runs after every run (`if: always()`), plus a sweep of leftovers older than 6 hours on staging. The outbox is left alone (append-only log).
   - `.github/workflows/step-04-e2e.yml`: PR into main -> type-check and tests; PR into dev or prod, and merges into dev -> deploy staging, full suite, cleanup; merge into prod -> migrate, deploy production, smoke check, cleanup.
   - Found by the first runs: Cloudflare killed requests for exceeding CPU (Error 1102). Building Better Auth on every request cost ~20 ms; it is now built once per Worker instance (tool calls: median 12 ms -> 6 ms). Password hashing (scrypt) still takes 100-370 ms on sign-up, sign-in and joining, above the Free plan's 10 ms: the Workers Paid plan (30 s default) is the fix; don't weaken the hash.
   - One-time setup (the user): create branches `dev` and `prod` from main; GitHub environments `staging` and `production` with the secrets listed in the workflow header (`STAGING_BETTER_AUTH_SECRET` = the value in the git-ignored `step-04-auth/.env.staging-auth-secret`); a Cloudflare API token with Workers Scripts Edit, D1 Edit, Workers KV Storage Edit, Secrets Store Read and Account Settings Read. A Cloudflare token can't be limited to staging resources, so restrict the production environment to the prod branch with required reviewers.
7. **Deploy and connect:** create D1 remotely, apply migrations, deploy, sign in from Claude and ChatGPT.
8. **Security review** (README prompt 8): token validation, redirect URIs, secrets, CORS, rate limits.
9. **NOTES.md, screenshots, defence video**, then branch and PR.

## What I need to do myself

- ✅ Created `BETTER_AUTH_SECRET_STEP_04` in the Cloudflare Secrets Store (27 November 2026; status active, scope workers), typing the value at the prompt (no `--value`, so it stays out of shell history):
  1. Generate a value: `openssl rand -base64 32`
  2. Remote, for the deployed Worker: `npx wrangler secrets-store secret create c706247e536c41458c52b8fc2480dc73 --name BETTER_AUTH_SECRET_STEP_04 --scopes workers --remote`
  3. Local, for `wrangler dev` (a different, dev-only value): the same command without `--remote`
- Sign up, connect and test in Claude and ChatGPT; take screenshots.
- Record the defence video.

## Verification at the end

- `npm run typecheck` and `npm test` pass: unit tests for every service, integration tests through the Worker.
- Live: unauthenticated `/mcp` returns 401 with discovery; Claude and ChatGPT complete sign-in; each sees only their own notes; a second account in another organization can't see the first's notes; a member is refused the admin tools; the outbox has events for every change.

## Risks

- **Size:** this is several steps' worth of work. Stages keep it testable; the defence should focus on one tool end to end and how the organization scopes notes.
- **Better Auth details:** confirmed in stage 0, except the CIMD fetch transport on Workers (built in stage 1).
- **Triggers:** confirmed in stage 0 (local and remote), including rollback with a failed batch.
- **Steps 05 to 07:** will need small additions for the tenant level; per-organization row-level security stays as the bootcamp teaches.

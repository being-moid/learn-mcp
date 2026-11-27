import { cimd } from "@better-auth/cimd";
import { mcp } from "@better-auth/mcp";
import { waitUntil } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { jwt, organization } from "better-auth/plugins";
import type { NewUser } from "../../domain/entities/tenant";
import type { IdentityProvider } from "../../domain/ports/auth/identity-provider";
import { BetterAuthIdentityProvider, type OrganizationApi } from "./better-auth-identity-provider";
import { workersMetadataFetch } from "./cimd-fetch";

// Better Auth configured as this MCP server's OAuth 2.1 authorization server.
// Every option below is explained, because this config is the security
// boundary of the whole server.

export interface BetterAuthConfig {
  /** The D1 database for auth data (binding AUTH_DB). */
  database: D1Database;
  /** Signs sessions, tokens and the signed OAuth query; from the Secrets Store. */
  secret: string;
  /** This Worker's own origin, e.g. https://learn-mcp-step-05.<sub>.workers.dev. */
  baseURL: string;
}

/**
 * What should happen at moments in a user's life, supplied by the
 * composition root (so this infrastructure module never imports application
 * services). Implemented with OnboardingService.
 */
export interface AuthLifecycle {
  /** Sets up a new user's tenant and organization; safe to call more than once. */
  onboard(user: NewUser, identity: IdentityProvider): Promise<void>;
  /** Gives a newly created organization (however it was created) its default roles. */
  onOrganizationCreated(organizationId: string): Promise<void>;
  /** The organization a new session should act for, or null. */
  defaultOrganizationFor(userId: string): Promise<string | null>;
  /** Whether the user belongs to several organizations and must pick one when connecting. */
  mustChooseOrganization(userId: string): Promise<boolean>;
  /** Emails a new user the link that confirms their address. */
  sendVerificationEmail(input: { to: string; name: string; url: string; token: string }): Promise<void>;
}

/**
 * Runs an email send in the background: the response doesn't wait for it, so
 * how long a request takes can't reveal whether an address has an account.
 * A failed send is logged.
 */
function sendInBackground(what: string, send: Promise<void>): void {
  waitUntil(send.catch((err) => console.error(JSON.stringify({ email: what, error: err instanceof Error ? err.message : String(err) }))));
}

/** Where Better Auth's endpoints live; the issuer is `${baseURL}${AUTH_BASE_PATH}`. */
export const AUTH_BASE_PATH = "/api/auth";
export const SIGN_IN_PATH = "/sign-in";
export const CONSENT_PATH = "/consent";
export const MCP_PATH = "/mcp";
/** Where a user with several organizations picks one (stage 3). */
export const SELECT_ORGANIZATION_PATH = "/select-organization";
export const ACCEPT_INVITATION_PATH = "/accept-invitation";

/**
 * The access-token claim carrying the organization the user chose when they
 * connected. Namespaced (a URL) so it can't collide with standard claims.
 */
export const ORGANIZATION_CLAIM = "https://stockroom.example/organization_id";

export function createBetterAuth({ database, secret, baseURL }: BetterAuthConfig, lifecycle: AuthLifecycle) {
  // The hooks below need Better Auth's own API (to create organizations),
  // which only exists once the instance is built: they reach it through this
  // reference, filled in right after construction.
  const api: { current?: OrganizationApi } = {};
  const identity = (): IdentityProvider => {
    if (!api.current) throw new Error("Better Auth isn't ready yet");
    return new BetterAuthIdentityProvider(api.current);
  };

  const auth = betterAuth({
    // Users, sessions, organizations and OAuth clients live in D1, which
    // every copy of the Worker can reach (never in memory).
    database,
    secret,
    baseURL,
    basePath: AUTH_BASE_PATH,

    // How people sign in on our /sign-in page (choice 1 in PLAN.md). A new
    // account must confirm its email address before it can sign in: without
    // that, anyone could sign up claiming someone else's address and accept
    // an invitation sent to it.
    emailAndPassword: { enabled: true, minPasswordLength: 10, requireEmailVerification: true },
    emailVerification: {
      sendOnSignUp: true,
      // Signing in with an unconfirmed address sends a fresh link.
      sendOnSignIn: true,
      // Following the link signs the user in.
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url, token }) => {
        sendInBackground("verification", lifecycle.sendVerificationEmail({ to: user.email, name: user.name, url, token }));
      },
    },

    // Limits repeated sign-in and registration attempts. Stored in D1 so the
    // limit holds across every copy of the Worker; memory would reset per copy.
    rateLimit: { enabled: true, storage: "database" },

    // Where the caller's IP address comes from, for rate limits and session
    // records. On Cloudflare that is cf-connecting-ip: Cloudflare sets it and
    // overwrites any value a client sends. The default (x-forwarded-for) can
    // be faked by any client, which would let one client dodge the rate limit.
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },

    databaseHooks: {
      user: {
        create: {
          // Every new user gets a tenant and a personal organization (stage 3).
          // A failure is logged, not thrown: the account exists already, and
          // the session hook below finishes onboarding at the next sign-in.
          after: async (user) => {
            try {
              await lifecycle.onboard({ id: user.id, name: user.name, email: user.email }, identity());
            } catch (err) {
              console.error(JSON.stringify({ onboarding: "failed", userId: user.id, error: err instanceof Error ? err.message : String(err) }));
            }
          },
        },
      },
      session: {
        create: {
          // Every new session starts on the user's default organization, so the
          // first token already names one. If onboarding never finished, it is
          // completed here first.
          before: async (session) => {
            if (session.activeOrganizationId) return;
            let organizationId = await lifecycle.defaultOrganizationFor(session.userId);
            if (!organizationId) {
              const user = await database.prepare(`SELECT "id", "name", "email" FROM "user" WHERE "id" = ?`).bind(session.userId).first<NewUser>();
              if (user) await lifecycle.onboard(user, identity());
              organizationId = await lifecycle.defaultOrganizationFor(session.userId);
            }
            if (organizationId) return { data: { ...session, activeOrganizationId: organizationId } };
          },
        },
      },
    },

    plugins: [
      // Signs access tokens as JWTs (RFC 9068) and publishes the public keys
      // at /api/auth/jwks, so tokens can be verified without a database call.
      jwt(),

      // Companies (tenants), members and roles. `tenantId` links each
      // organization to the tenant that owns it (filled in during onboarding,
      // stage 3); `input: false` stops a client from setting it.
      organization({
        // Accepting an invitation requires a confirmed email address that
        // matches it. Invitation emails are sent by the outbox relay (it sees
        // every new invitation row), so Better Auth doesn't send them here.
        requireEmailVerificationOnInvitation: true,
        // Every organization gets its built-in Owner, Admin and Member roles
        // the moment it exists, whoever created it and however.
        organizationHooks: {
          afterCreateOrganization: async ({ organization }) => lifecycle.onOrganizationCreated(organization.id),
        },
        schema: {
          organization: {
            additionalFields: { tenantId: { type: "string", required: false, input: false } },
          },
        },
      }),

      // The OAuth provider for MCP. Tokens are bound to our /mcp resource
      // (audience), and it serves the protected-resource metadata clients
      // discover after a 401. Unauthenticated users are sent to our sign-in
      // page; first-time approvals go to our consent page.
      mcp({
        resource: `${baseURL}${MCP_PATH}`,
        loginPage: SIGN_IN_PATH,
        consentPage: CONSENT_PATH,
        // Dynamic Client Registration is deprecated in MCP 2026-07-28 but
        // still allowed. It stays on as a fallback for clients that don't use
        // CIMD; open registration is limited by the rate limit above.
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,

        // Which organization this connection acts for. After sign-in, consent
        // is recorded per organization (consentReferenceId = the session's
        // active organization), and that ID is written into every access token
        // as ORGANIZATION_CLAIM. The /mcp side reads it from the verified
        // token, never from a tool argument.
        postLogin: {
          page: SELECT_ORGANIZATION_PATH,
          // Users who belong to several organizations pick one first. On the
          // way back (isContinuation), the session's active organization must
          // be one they belong to, or they are sent to pick again.
          shouldRedirect: async ({ user, session, isContinuation }) => {
            if (!(await lifecycle.mustChooseOrganization(user.id))) return false;
            if (!isContinuation) return true;
            const active = session.activeOrganizationId as string | null | undefined;
            return !active || !(await isMember(database, user.id, active));
          },
          consentReferenceId: ({ session }) => (session.activeOrganizationId as string | null | undefined) ?? undefined,
        },
        customAccessTokenClaims: ({ referenceId }) => (referenceId ? { [ORGANIZATION_CLAIM]: referenceId } : {}),
      }),

      // Client ID Metadata Documents: the preferred way for Claude and ChatGPT
      // to identify themselves (their client_id is a URL to their metadata).
      cimd({
        fetchClientMetadataResource: workersMetadataFetch,
        metadataProfile: "mcp-2026-07-28",
      }),
    ],
  });
  api.current = auth.api as unknown as OrganizationApi;
  return auth;
}

async function isMember(database: D1Database, userId: string, organizationId: string): Promise<boolean> {
  const row = await database
    .prepare(`SELECT 1 AS ok FROM "member" WHERE "userId" = ? AND "organizationId" = ?`)
    .bind(userId, organizationId)
    .first();
  return row !== null;
}

export type BetterAuthInstance = ReturnType<typeof createBetterAuth>;

import { requireMcpAuth } from "@better-auth/mcp";
import type { AuthProvider, AuthResult } from "../../domain/ports/auth/auth-provider";
import { readAuthSecret, type AuthSecretBindings } from "./auth-secret";
import { AUTH_BASE_PATH, createBetterAuth, MCP_PATH, ORGANIZATION_CLAIM, type AuthLifecycle, type BetterAuthInstance } from "./better-auth";

// The AuthProvider port on Better Auth.
//
// handleRoute: serves Better Auth's endpoints (/api/auth/*: sign-in, OAuth
// authorize/token/consent, registration, JWKS) and the discovery documents
// MCP clients look for (/.well-known/oauth-protected-resource[/mcp],
// /.well-known/oauth-authorization-server/api/auth, …).
//
// authenticate: verifies the bearer token on /mcp with Better Auth's own
// requireMcpAuth (signature from our JWKS, issuer, audience = our /mcp
// resource, expiry). A missing or bad token gets Better Auth's 401 with the
// resource_metadata challenge, which is how Claude and ChatGPT find our
// sign-in. Membership is checked separately, on every request, by the access
// service (a token can outlive a membership).

export interface BetterAuthProviderBindings extends AuthSecretBindings {
  AUTH_DB: D1Database;
}

/**
 * The only Better Auth organization endpoints a browser may call: what our
 * pages need to pick an organization and answer an invitation. Every other
 * one (update-member-role, remove-member, invite-member, create, update,
 * delete, get-full-organization, list-members, …) would let a signed-in user
 * change members or roles, or read them, without our permission checks and
 * guardrails (RolesService, MembersService). Those changes go through the
 * MCP tools instead, so they're refused here.
 */
const ALLOWED_ORGANIZATION_ENDPOINTS = new Set(["list", "set-active", "get-invitation", "accept-invitation", "reject-invitation"]);

/** One Better Auth per origin per Worker instance (see auth() below). */
const instances = new Map<string, { secret: string; database: D1Database; auth: BetterAuthInstance }>();

export class BetterAuthProvider implements AuthProvider {
  constructor(
    private readonly bindings: BetterAuthProviderBindings,
    private readonly lifecycle: AuthLifecycle,
  ) {}

  /**
   * Better Auth for this request's origin, so the issuer and the /mcp
   * resource are correct on workers.dev, on localhost and in tests alike.
   *
   * Built once per Worker instance and origin, then reused: building it
   * (every plugin, every endpoint) costs ~20 ms of CPU, more than the Free
   * plan's whole per-request budget, and the end-to-end tests saw requests
   * killed for it. It holds configuration only (the database binding, the
   * secret, hooks that read the database each time), never data from a
   * request, so reusing it doesn't carry anything between users. A changed
   * secret (rotation) builds a new one.
   */
  private async auth(request: Request): Promise<BetterAuthInstance> {
    const secret = await readAuthSecret(this.bindings);
    const baseURL = new URL(request.url).origin;
    const cached = instances.get(baseURL);
    if (cached && cached.secret === secret && cached.database === this.bindings.AUTH_DB) return cached.auth;
    const auth = createBetterAuth({ database: this.bindings.AUTH_DB, secret, baseURL }, this.lifecycle);
    instances.set(baseURL, { secret, database: this.bindings.AUTH_DB, auth });
    return auth;
  }

  async handleRoute(request: Request): Promise<Response | undefined> {
    const { pathname } = new URL(request.url);
    const organizationPrefix = `${AUTH_BASE_PATH}/organization/`;
    if (pathname.startsWith(organizationPrefix) && !ALLOWED_ORGANIZATION_ENDPOINTS.has(pathname.slice(organizationPrefix.length))) {
      return Response.json(
        { error: "not_available", message: "Members and roles are managed with Stockroom's tools (invite_member, assign_member_role, remove_member), not here." },
        { status: 403 },
      );
    }
    if (pathname.startsWith(`${AUTH_BASE_PATH}/`) || pathname.startsWith("/.well-known/")) {
      const auth = await this.auth(request);
      return auth.handler(request);
    }
    return undefined;
  }

  async signIn(request: Request, email: string, password: string): Promise<string[] | null> {
    const auth = await this.auth(request);
    const response = await auth.api.signInEmail({ body: { email, password }, headers: request.headers, asResponse: true });
    return response.ok ? response.headers.getSetCookie() : null;
  }

  async authenticate(request: Request): Promise<AuthResult> {
    const auth = await this.auth(request);
    const resource = `${new URL(request.url).origin}${MCP_PATH}`;

    // requireMcpAuth wraps a handler; ours only captures the verified claims.
    // It is given a clone so the original body stays readable for MCP.
    let claims: Record<string, unknown> | undefined;
    const verify = requireMcpAuth(
      auth,
      (_request, verified) => {
        claims = verified;
        return new Response(null, { status: 204 });
      },
      { resource },
    );
    const verdict = await verify(request.clone());
    if (!claims) return { ok: false, response: verdict }; // 401 (or 403) with the challenge

    const userId = claims.sub;
    const organizationId = claims[ORGANIZATION_CLAIM];
    if (typeof userId !== "string" || !userId) {
      return { ok: false, response: forbidden("invalid_token", "The access token has no subject.", 401) };
    }
    if (typeof organizationId !== "string" || !organizationId) {
      return {
        ok: false,
        response: forbidden("no_organization", "This connection has no organization. Reconnect and choose the organization to use."),
      };
    }
    return { ok: true, principal: { kind: "user", userId, organizationId } };
  }
}

function forbidden(error: string, description: string, status = 403): Response {
  return Response.json({ error, error_description: description }, { status });
}

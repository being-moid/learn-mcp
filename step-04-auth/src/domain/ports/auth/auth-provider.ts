import type { Principal } from "../../entities/principal";

// The whole authentication layer behind one interface. Each implementation
// (anonymous today, Better Auth from stage 1, an enterprise identity provider
// later) is one class, and the composition root picks one. Request and
// Response are web-standard types, not Cloudflare-specific ones.

/** The outcome of checking one request's credentials. */
export type AuthResult =
  | { ok: true; principal: Principal }
  /** Not allowed: send this response as-is (e.g. a 401 with discovery headers). */
  | { ok: false; response: Response };

export interface AuthProvider {
  /** Checks the request's credentials for /mcp and says who is calling. */
  authenticate(request: Request): Promise<AuthResult>;

  /**
   * Serves the provider's own HTTP routes (sign-in pages, OAuth endpoints,
   * discovery documents). Returns undefined for paths it doesn't own.
   */
  handleRoute(request: Request): Promise<Response | undefined>;

  /**
   * Signs someone in with their email and password, as if from the sign-in
   * page, and returns the session cookies to set (Set-Cookie values), or
   * null if the provider refused. Used right after an invitation sign-up.
   */
  signIn(request: Request, email: string, password: string): Promise<string[] | null>;
}

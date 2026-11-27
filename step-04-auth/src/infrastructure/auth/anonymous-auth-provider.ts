import { ANONYMOUS } from "../../domain/entities/principal";
import type { AuthProvider, AuthResult } from "../../domain/ports/auth/auth-provider";

// Today's behaviour as an AuthProvider: no sign-in, every caller is the
// anonymous principal, and there are no auth routes. Stage 1 replaces it with
// a Better Auth provider by changing one line in composition.ts.
export class AnonymousAuthProvider implements AuthProvider {
  async authenticate(): Promise<AuthResult> {
    return { ok: true, principal: ANONYMOUS };
  }

  async handleRoute(): Promise<Response | undefined> {
    return undefined;
  }

  /** There are no accounts to sign in to. */
  async signIn(): Promise<string[] | null> {
    return null;
  }
}

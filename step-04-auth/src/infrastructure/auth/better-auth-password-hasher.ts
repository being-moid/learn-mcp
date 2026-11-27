import { hashPassword } from "better-auth/crypto";
import type { PasswordHasher } from "../../domain/ports/auth/password-hasher";

/** PasswordHasher in Better Auth's own format (scrypt), so its sign-in accepts the password. */
export class BetterAuthPasswordHasher implements PasswordHasher {
  hash(password: string): Promise<string> {
    return hashPassword(password);
  }
}

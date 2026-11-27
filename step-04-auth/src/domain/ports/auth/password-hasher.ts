/** Hashes a password in the auth library's own format, so the library can check it at sign-in. */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
}

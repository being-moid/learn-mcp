import type { InvitationLinkTokens } from "../../domain/ports/auth/invitation-link-tokens";

// Invitation link tokens as an HMAC of the invitation ID, keyed by the
// server's auth secret. Nothing is stored: the token can be recomputed to
// check it, and only someone holding the secret (this server) can make one.
// The purpose label keeps these signatures from being valid for anything else
// signed with the same secret.

const PURPOSE = "stockroom/invitation-link/v1:";
const encoder = new TextEncoder();

export class HmacInvitationLinkTokens implements InvitationLinkTokens {
  private key?: Promise<CryptoKey>;

  constructor(private readonly secret: () => Promise<string>) {}

  async tokenFor(invitationId: string): Promise<string> {
    const signature = await crypto.subtle.sign("HMAC", await this.hmacKey(), encoder.encode(PURPOSE + invitationId));
    return toBase64Url(new Uint8Array(signature));
  }

  async matches(invitationId: string, token: string): Promise<boolean> {
    const signature = fromBase64Url(token);
    if (!signature || signature.length !== 32) return false;
    // verify() compares in constant time, so timing reveals nothing about the token.
    return crypto.subtle.verify("HMAC", await this.hmacKey(), signature, encoder.encode(PURPOSE + invitationId));
  }

  private hmacKey(): Promise<CryptoKey> {
    this.key ??= this.secret().then((secret) =>
      crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]),
    );
    return this.key;
  }
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(text)) return null;
  try {
    const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

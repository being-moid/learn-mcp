import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { linkIn, waitForEmail } from "../helpers/oauth";

// Signing up and in through the real Worker, as the /sign-in page does.
const BASE = "https://learn-mcp-step-04.example.workers.dev";
const headers = { "content-type": "application/json", host: new URL(BASE).host, origin: BASE };
// Each call comes from its own IP, as different people would, so these tests
// don't trip the per-IP rate limit on each other.
const fromSomeone = () => ({ ...headers, "cf-connecting-ip": `198.51.100.${Math.floor(Math.random() * 250) + 1}` });
const post = (path: string, body: unknown) =>
  exports.default.fetch(`${BASE}${path}`, { method: "POST", headers: fromSomeone(), body: JSON.stringify(body) });

describe("email and password accounts", () => {
  it("creates an account and stores the user in D1", async () => {
    const email = `ayesha-${crypto.randomUUID()}@example.com`;
    const res = await post("/api/auth/sign-up/email", { name: "Ayesha", email, password: "correct-horse-battery" });
    expect(res.status).toBe(200);
    const row = await env.AUTH_DB.prepare('SELECT name, email FROM "user" WHERE email = ?').bind(email).first();
    expect(row).toEqual({ name: "Ayesha", email });
  });

  it("refuses to sign in until the email address is confirmed, then signs in", async () => {
    const email = `ali-${crypto.randomUUID()}@example.com`;
    await post("/api/auth/sign-up/email", { name: "Ali", email, password: "correct-horse-battery" });
    const before = await post("/api/auth/sign-in/email", { email, password: "correct-horse-battery" });
    expect(before.status).toBe(403);

    // Follow the link from the confirmation email, then sign in.
    await exports.default.fetch(linkIn(await waitForEmail(email)), { headers, redirect: "manual" });
    const after = await post("/api/auth/sign-in/email", { email, password: "correct-horse-battery" });
    expect(after.status).toBe(200);
    expect(after.headers.get("set-cookie")).toMatch(/session_token=/);
  });

  it("sends the confirmation email from the notifications address", async () => {
    const email = `nadia-${crypto.randomUUID()}@example.com`;
    await post("/api/auth/sign-up/email", { name: "Nadia", email, password: "correct-horse-battery" });
    const message = await waitForEmail(email);
    expect(message.category).toBe("notification");
    expect(message.subject).toBe("Confirm your email for Stockroom");
    expect(linkIn(message)).toContain("/api/auth/verify-email?token=");
  });

  it("refuses a wrong password and a password shorter than 10 characters", async () => {
    const email = `sara-${crypto.randomUUID()}@example.com`;
    expect((await post("/api/auth/sign-up/email", { name: "Sara", email, password: "short" })).status).toBe(400);
    await post("/api/auth/sign-up/email", { name: "Sara", email, password: "correct-horse-battery" });
    await exports.default.fetch(linkIn(await waitForEmail(email)), { headers, redirect: "manual" });
    expect((await post("/api/auth/sign-in/email", { email, password: "wrong-password-123" })).status).toBe(401);
  });
});

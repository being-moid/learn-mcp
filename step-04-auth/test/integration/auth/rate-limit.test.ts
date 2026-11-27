import { exports } from "cloudflare:workers";
import { expect, it } from "vitest";
import { BASE } from "../helpers/oauth";

// Better Auth identifies callers by cf-connecting-ip, which Cloudflare sets
// and overwrites. Faking x-forwarded-for on every request must not help an
// attacker dodge the sign-in rate limit.
it("rate-limits repeated sign-ins from one IP even when x-forwarded-for is faked", async () => {
  const statuses: number[] = [];
  for (let i = 0; i < 8; i++) {
    const res = await exports.default.fetch(`${BASE}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: new URL(BASE).host,
        origin: BASE,
        "cf-connecting-ip": "198.51.100.77",
        "x-forwarded-for": `10.0.0.${i + 1}`,
      },
      body: JSON.stringify({ email: "nobody@example.com", password: "wrong-password-123" }),
    });
    statuses.push(res.status);
  }
  expect(statuses).toContain(429);
});

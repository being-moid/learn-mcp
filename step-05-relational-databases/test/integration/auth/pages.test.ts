import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("sign-in and consent pages", () => {
  for (const path of ["/sign-in", "/consent"]) {
    it(`${path} is served with a strict security policy`, async () => {
      const res = await exports.default.fetch(`https://example.com${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      const csp = res.headers.get("content-security-policy")!;
      const nonce = /'nonce-([^']+)'/.exec(csp)![1];
      // Only the script carrying this response's nonce may run.
      expect(await res.text()).toContain(`<script nonce="${nonce}">`);
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("connect-src 'self'");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      expect(res.headers.get("cache-control")).toBe("no-store");
    });
  }

  it("uses a different nonce on every response", async () => {
    const nonces = await Promise.all(
      [1, 2].map(async () => (await exports.default.fetch("https://example.com/sign-in")).headers.get("content-security-policy")),
    );
    expect(nonces[0]).not.toBe(nonces[1]);
  });

  // The scripts are written inside TypeScript template strings, where a
  // backslash can silently vanish and leave invalid JavaScript (a regex did
  // exactly that once, and every button on /sign-in stopped working).
  for (const path of ["/sign-in", "/consent", "/select-organization", "/accept-invitation"]) {
    it(`${path} serves a script that parses`, async () => {
      const html = await (await exports.default.fetch(`https://example.com${path}`)).text();
      const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html)![1];
      expect(() => new Function(script)).not.toThrow();
    });
  }

  // If the script ever fails again, the browser submits the form itself. A
  // GET would put the password in the URL (and so in request logs); a POST
  // keeps it in the body. This happened once in production.
  for (const path of ["/sign-in", "/select-organization", "/accept-invitation"]) {
    it(`${path} forms never submit with GET`, async () => {
      const html = await (await exports.default.fetch(`https://example.com${path}`)).text();
      const forms = html.match(/<form[^>]*>/g) ?? [];
      expect(forms.length).toBeGreaterThan(0);
      for (const form of forms) expect(form).toContain('method="post"');
    });
  }
});

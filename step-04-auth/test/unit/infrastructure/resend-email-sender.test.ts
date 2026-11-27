import { afterEach, describe, expect, it, vi } from "vitest";
import { ResendEmailSender } from "../../../src/infrastructure/email/resend-email-sender";

const message = { category: "invitation" as const, to: "a@example.com", subject: "Hi", text: "t", html: "<p>t</p>", idempotencyKey: "invitation:1" };
const from = { invitation: "Stockroom <verification@moidshams.dev>", notification: "Stockroom <donotreply@moidshams.dev>" };

describe("ResendEmailSender", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("calls the global fetch correctly when none is passed in", async () => {
    // Like the real Workers fetch: it refuses to be called with another `this`.
    // (Production failed with "Illegal invocation" before this was fixed.)
    const calls: string[] = [];
    vi.stubGlobal("fetch", function (this: unknown, input: RequestInfo | URL) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
      calls.push(String(input));
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    await new ResendEmailSender(async () => "k", from).send(message);
    expect(calls).toEqual(["https://api.resend.com/emails"]);
  });

  it("posts to Resend with the key, the category's from-address and the idempotency key", async () => {
    let request: Request | undefined;
    const sender = new ResendEmailSender(async () => "re_test_key", from, async (input, init) => {
      request = new Request(input, init);
      return new Response(JSON.stringify({ id: "email-1" }), { status: 200 });
    });
    await sender.send(message);
    expect(request!.url).toBe("https://api.resend.com/emails");
    expect(request!.headers.get("authorization")).toBe("Bearer re_test_key");
    expect(request!.headers.get("idempotency-key")).toBe("invitation:1");
    expect(await request!.json()).toMatchObject({ from: from.invitation, to: ["a@example.com"], subject: "Hi" });

    await sender.send({ ...message, category: "notification" });
  });

  it("uses the notifications address for notifications", async () => {
    let body: { from?: string } = {};
    const sender = new ResendEmailSender(async () => "k", from, async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return new Response("{}", { status: 200 });
    });
    await sender.send({ ...message, category: "notification" });
    expect(body.from).toBe(from.notification);
  });

  it("explains a refusal without revealing the key", async () => {
    const sender = new ResendEmailSender(async () => "re_secret_key", from, async () =>
      new Response(JSON.stringify({ message: "The moidshams.dev domain is not verified" }), { status: 403 }),
    );
    const error = await sender.send(message).catch((e: Error) => e);
    expect(String(error)).toContain("domain is not verified");
    expect(String(error)).not.toContain("re_secret_key");
  });
});

import { describe, expect, it } from "vitest";
import { AccountEmails } from "../../../../src/application/services/account-emails";
import { FakeEmailSender } from "../../../fakes/recording-email-sender";

describe("AccountEmails", () => {
  it("escapes user-supplied names in the HTML", async () => {
    const sender = new FakeEmailSender();
    await new AccountEmails(sender).sendInvitation({
      to: "a@example.com",
      organizationName: '<script>alert("x")</script>',
      inviterName: "Eve <b>",
      url: "https://stockroom.example/accept-invitation?id=1",
      invitationId: "1",
    });
    expect(sender.sent[0].html).not.toContain("<script>");
    expect(sender.sent[0].html).toContain("&lt;script&gt;");
    expect(sender.sent[0].html).toContain("Eve &lt;b&gt;");
  });

  it("sends verification as a notification and invitations as invitations, with stable keys", async () => {
    const sender = new FakeEmailSender();
    const emails = new AccountEmails(sender);
    await emails.sendVerification({ to: "a@example.com", name: "Ali", url: "https://x/verify", token: "tok" });
    await emails.sendInvitation({ to: "b@example.com", organizationName: "Org", inviterName: "Ali", url: "https://x/accept", invitationId: "inv" });
    expect(sender.sent.map((m) => [m.category, m.idempotencyKey])).toEqual([
      ["notification", "verify-email:tok"],
      ["invitation", "invitation:inv"],
    ]);
  });
});

import type { EmailCategory, EmailMessage, EmailSender } from "../../domain/ports/notifications/email-sender";

// EmailSender on Resend's HTTPS API (https://resend.com/docs/api-reference/emails/send-email).
// The API key is read from the Secrets Store only when an email is sent, and
// never appears in errors or logs. Each kind of email has its own from-address.
export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: () => Promise<string>,
    private readonly fromByCategory: Readonly<Record<EmailCategory, string>>,
    // Wrapped, not `= fetch`: calling the stored function as this.fetchImpl(...)
    // would pass the sender as `this`, and Workers rejects that ("Illegal invocation").
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const response = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${await this.apiKey()}`,
        "content-type": "application/json",
        // Resend delivers a message once per key, so a retried send is harmless.
        "idempotency-key": message.idempotencyKey,
      },
      body: JSON.stringify({ from: this.fromByCategory[message.category], to: [message.to], subject: message.subject, text: message.text, html: message.html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      // Resend's error body explains the problem (e.g. an unverified domain); it never contains the key.
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`Resend refused the email (HTTP ${response.status}): ${detail}`);
    }
  }
}

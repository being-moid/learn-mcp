import type { EmailMessage, EmailSender } from "../../domain/ports/notifications/email-sender";

// An EmailSender for tests: it records messages instead of sending them, so
// tests can read the verification and invitation links. The composition root
// only uses it when the Vitest-only EMAIL_SENDER_FOR_TESTS binding is set
// (wrangler.jsonc never sets it), so production always uses Resend.
export class RecordingEmailSender implements EmailSender {
  /** Every message "sent" in this test run, newest last. */
  static readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    RecordingEmailSender.sent.push(message);
  }

  /** The most recent message sent to `to`, if any. */
  static lastTo(to: string): EmailMessage | undefined {
    return [...RecordingEmailSender.sent].reverse().find((m) => m.to === to);
  }
}

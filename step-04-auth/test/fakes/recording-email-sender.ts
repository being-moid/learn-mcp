import type { EmailMessage, EmailSender } from "../../src/domain/ports/notifications/email-sender";

/** An EmailSender for unit tests that keeps its own list (separate from the Worker's recorder). */
export class FakeEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }
}

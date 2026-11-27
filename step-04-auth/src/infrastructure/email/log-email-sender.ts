import type { EmailMessage, EmailSender } from "../../domain/ports/notifications/email-sender";

/**
 * An EmailSender that only logs that an email would have gone out: for
 * staging, where tests run against made-up addresses. It never logs the
 * body or the recipient's full address, because links in emails carry
 * sign-in and invitation tokens.
 */
export class LogEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<void> {
    console.log(JSON.stringify({ emailNotSent: message.category, toDomain: message.to.split("@")[1] ?? "", subject: message.subject }));
  }
}

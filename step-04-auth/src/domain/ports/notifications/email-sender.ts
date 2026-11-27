/** What kind of email this is; each kind is sent from its own address. */
export type EmailCategory = "invitation" | "notification";

/** One email to send. */
export interface EmailMessage {
  category: EmailCategory;
  to: string;
  subject: string;
  text: string;
  html: string;
  /**
   * Identifies this message, so sending it twice (a retry) delivers it once.
   * The same logical email must always get the same key.
   */
  idempotencyKey: string;
}

/** Sends email. Implemented with Resend; recorded in memory in tests. */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

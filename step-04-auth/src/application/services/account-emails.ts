import type { EmailSender } from "../../domain/ports/notifications/email-sender";

// The emails Stockroom sends about accounts: confirming an email address, and
// inviting someone to an organization. Their wording lives here; how they are
// delivered is the EmailSender's job.
//
// Names come from users (an organization's name, an inviter's name), so they
// are escaped before going into HTML: a name can't inject markup into
// someone's inbox.

export class AccountEmails {
  constructor(private readonly sender: EmailSender) {}

  /** Asks a new user to confirm their address. `token` identifies this request, so a retry sends it once. */
  async sendVerification(input: { to: string; name: string; url: string; token: string }): Promise<void> {
    const greeting = input.name.trim() ? `Hi ${input.name.trim()},` : "Hi,";
    await this.sender.send({
      category: "notification",
      to: input.to,
      subject: "Confirm your email for Stockroom",
      text: `${greeting}\n\nConfirm your email address to finish setting up your Stockroom account:\n${input.url}\n\nIf you didn't sign up, you can ignore this email.`,
      html: layout(
        `<p>${escapeHtml(greeting)}</p>
         <p>Confirm your email address to finish setting up your Stockroom account.</p>
         <p><a href="${escapeHtml(input.url)}">Confirm my email</a></p>
         <p style="color:#6b6b70">If you didn't sign up, you can ignore this email.</p>`,
      ),
      idempotencyKey: `verify-email:${input.token}`,
    });
  }

  /** Invites someone to join an organization. */
  async sendInvitation(input: { to: string; organizationName: string; inviterName: string; url: string; invitationId: string }): Promise<void> {
    const who = input.inviterName.trim() || "A colleague";
    await this.sender.send({
      category: "invitation",
      to: input.to,
      subject: `${who} invited you to ${input.organizationName} on Stockroom`,
      text: `${who} invited you to join ${input.organizationName} on Stockroom.\n\nAccept the invitation:\n${input.url}\n\nThe invitation expires in 48 hours. If you weren't expecting it, you can ignore this email.`,
      html: layout(
        `<p>${escapeHtml(who)} invited you to join <strong>${escapeHtml(input.organizationName)}</strong> on Stockroom.</p>
         <p><a href="${escapeHtml(input.url)}">Accept the invitation</a></p>
         <p style="color:#6b6b70">The invitation expires in 48 hours. If you weren't expecting it, you can ignore this email.</p>`,
      ),
      idempotencyKey: `invitation:${input.invitationId}`,
    });
  }
}

function layout(body: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.5;color:#1c1c1e">${body}</body></html>`;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

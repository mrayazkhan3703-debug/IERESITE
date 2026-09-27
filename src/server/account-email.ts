import { getConfig } from "@/lib/config";
import { sendTransactionalEmail } from "@/server/email/adapter";

function accountLink(path: string, token: string): string {
  const url = new URL(path, getConfig().APP_URL);
  url.searchParams.set("token", token);
  return url.toString();
}

export function sendVerificationEmail(email: string, token: string) {
  const link = accountLink("/account/verify-email", token);
  return sendTransactionalEmail({
    to: email,
    subject: "Verify your Investment Experts account",
    text: `Verify your email address by opening this link:\n\n${link}\n\nThis link expires in 24 hours and can be used once.`,
  });
}

export function sendPasswordResetEmail(email: string, token: string) {
  const link = accountLink("/account/reset-password", token);
  return sendTransactionalEmail({
    to: email,
    subject: "Reset your Investment Experts password",
    text: `Reset your password by opening this link:\n\n${link}\n\nThis link expires in 30 minutes and can be used once. If you did not request it, ignore this message.`,
  });
}

export function sendEmailChangeConfirmation(email: string, token: string) {
  const link = accountLink("/account/confirm-email-change", token);
  return sendTransactionalEmail({
    to: email,
    subject: "Confirm your new Investment Experts email",
    text: `Confirm this email address by opening this link:\n\n${link}\n\nThis link expires in 30 minutes and can be used once.`,
  });
}

export function sendStaffInvitationEmail(email: string, token: string, roleKey: string) {
  const link = accountLink("/account/accept-invite", token);
  return sendTransactionalEmail({
    to: email,
    subject: "Your Investment Experts staff invitation",
    text: `You have been invited to join Investment Experts with the ${roleKey} role. Accept the invitation and set your password here:\n\n${link}\n\nThis link expires in 7 days and can be used once. If you were not expecting it, ignore this message.`,
  });
}

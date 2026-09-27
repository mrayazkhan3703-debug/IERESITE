import nodemailer from "nodemailer";
import { getConfig } from "@/lib/config";

export interface EmailDeliveryResult {
  accepted: boolean;
  provider: string;
  messageId: string | null;
}

export async function sendTransactionalEmail(input: {
  to: string;
  subject: string;
  text: string;
}): Promise<EmailDeliveryResult> {
  const config = getConfig();
  if (!config.SMTP_HOST) {
    return { accepted: false, provider: config.EMAIL_PROVIDER, messageId: null };
  }

  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    ...(config.SMTP_USER && config.SMTP_PASSWORD
      ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } }
      : {}),
  });
  const result = await transport.sendMail({
    from: `Investment Experts <${config.EMAIL_FROM}>`,
    to: input.to,
    subject: input.subject,
    text: input.text,
  });
  return {
    accepted: result.accepted.map(String).includes(input.to),
    provider: "smtp",
    messageId: result.messageId || null,
  };
}

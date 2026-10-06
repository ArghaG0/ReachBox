import nodemailer from "nodemailer";
import type { Email, Sender } from "@prisma/client";
import type { Env } from "../config/env.js";

export interface SendResult { messageId: string; previewUrl: string | null }
export type SendEmail = (email: Email & { sender: Sender }) => Promise<SendResult>;

export function createMailer(env: Env): SendEmail {
  return async (email) => {
    const transporter = nodemailer.createTransport({
      host: email.sender.smtpHost,
      port: email.sender.smtpPort,
      secure: email.sender.smtpPort === 465,
      auth: { user: email.sender.smtpUser, pass: email.sender.smtpPass },
      connectionTimeout: env.SMTP_CONNECTION_TIMEOUT_MS,
      greetingTimeout: env.SMTP_GREETING_TIMEOUT_MS,
      socketTimeout: env.SMTP_SOCKET_TIMEOUT_MS,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    let timeout: NodeJS.Timeout | undefined;
    try {
      const info = await Promise.race([transporter.sendMail({
        from: email.sender.email, to: email.toEmail,
        subject: email.subject, html: email.bodyHtml,
        messageId: `<email-${email.id}@reachbox.local>`,
      }), new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          transporter.close();
          reject(new Error("SMTP send deadline exceeded"));
        }, env.SMTP_SEND_TIMEOUT_MS);
      })]);
      return { messageId: info.messageId, previewUrl: nodemailer.getTestMessageUrl(info) || null };
    } finally {
      clearTimeout(timeout);
      transporter.close();
    }
  };
}

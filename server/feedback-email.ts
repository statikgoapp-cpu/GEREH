import nodemailer from "nodemailer";
import { logInfo } from "./logger";

const feedbackRecipient = process.env.FEEDBACK_EMAIL_TO || "statikgoapp@gmail.com";

const getTransporter = () => {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;
  const port = Number(process.env.SMTP_PORT || 587);
  if (!host || !user || !password) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === "true",
    requireTLS: port === 587,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    auth: { user, pass: password },
  });
};

export async function sendFeedbackEmail(feedback: {
  id: number;
  userId: number;
  email: string;
  category: string;
  message: string;
  page: string;
  createdAt: string;
}) {
  const transporter = getTransporter();
  if (!transporter) {
    throw new Error("Feedback SMTP environment variables are not configured");
  }

  const from = process.env.FEEDBACK_EMAIL_FROM || process.env.SMTP_USER;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === "true";
  logInfo(`[feedback-email] sending id=${feedback.id} host=${process.env.SMTP_HOST} port=${port} secure=${secure} to=${feedbackRecipient}`);
  await transporter.sendMail({
    from,
    to: feedbackRecipient,
    subject: "[GEREH BETA] Yeni Kullanıcı Geri Bildirimi",
    text: [
      "GEREH BETA GERİ BİLDİRİMİ",
      "",
      `Kategori: ${feedback.category}`,
      `Kullanıcı: ${feedback.email}`,
      `Kullanıcı ID: ${feedback.userId}`,
      `Sayfa: ${feedback.page}`,
      `Tarih: ${feedback.createdAt}`,
      `Feedback ID: ${feedback.id}`,
      "",
      "Mesaj:",
      feedback.message,
    ].join("\n"),
  });
  logInfo(`[feedback-email] sent id=${feedback.id}`);
}
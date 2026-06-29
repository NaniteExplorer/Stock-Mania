import nodemailer from "nodemailer";
import {
  NEWS_SUMMARY_EMAIL_TEMPLATE,
  WELCOME_EMAIL_TEMPLATE,
} from "@/lib/nodemailer/templates";
import { PASSWORD_RESET_EMAIL_TEMPLATE } from "@/lib/nodemailer/reset-template";
import { VERIFY_EMAIL_TEMPLATE } from "@/lib/nodemailer/verify-template";
import { BRAND } from "@/branding/brand";

// Sender uses the authenticated SMTP account with the brand as display name.
const FROM = `"${BRAND.name}" <${process.env.NODEMAILER_EMAIL}>`;

export const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.NODEMAILER_EMAIL!,
    pass: process.env.NODEMAILER_PASSWORD!,
  },
});

export const sendWelcomeEmail = async ({
  email,
  name,
  intro,
}: WelcomeEmailData) => {
  const htmlTemplate = WELCOME_EMAIL_TEMPLATE.replace("{{name}}", name).replace(
    "{{intro}}",
    intro,
  );

  const mailOptions = {
    from: FROM,
    to: email,
    subject: `Welcome to ${BRAND.name} - your stock market toolkit is ready`,
    text: `Thanks for joining ${BRAND.name}`,
    html: htmlTemplate,
  };

  await transporter.sendMail(mailOptions);
};

export const sendPasswordResetEmail = async ({
  email,
  name,
  url,
}: {
  email: string;
  name: string;
  url: string;
}) => {
  const htmlTemplate = PASSWORD_RESET_EMAIL_TEMPLATE.replace(
    "{{name}}",
    name || "there",
  ).replaceAll("{{url}}", url);

  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: `Reset your ${BRAND.name} password`,
    text: `Reset your ${BRAND.name} password using this link: ${url}`,
    html: htmlTemplate,
  });
};

export const sendVerificationEmail = async ({
  email,
  name,
  url,
}: {
  email: string;
  name: string;
  url: string;
}) => {
  const htmlTemplate = VERIFY_EMAIL_TEMPLATE.replace(
    "{{name}}",
    name || "there",
  ).replaceAll("{{url}}", url);

  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: `Verify your ${BRAND.name} email`,
    text: `Verify your ${BRAND.name} email using this link: ${url}`,
    html: htmlTemplate,
  });
};

type NewsSummaryEmailData = {
  email: string;
  date: string;
  newsContent: string;
};

export const sendNewsSummaryEmail = async ({
  email,
  date,
  newsContent,
}: NewsSummaryEmailData) => {
  const htmlTemplate = NEWS_SUMMARY_EMAIL_TEMPLATE.replace(
    "{{date}}",
    date,
  ).replace("{{newsContent}}", newsContent);

  const mailOptions = {
    from: FROM,
    to: email,
    subject: `${BRAND.name} market news summary - ${date}`,
    text: `Your ${BRAND.name} market news summary is ready.`,
    html: htmlTemplate,
  };

  await transporter.sendMail(mailOptions);
};

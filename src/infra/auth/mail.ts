import "server-only";

import nodemailer, { type Transporter } from "nodemailer";
import { config } from "@/shared/config/env";
import { BRAND } from "@/branding/brand";
import { WELCOME_EMAIL_TEMPLATE } from "@/lib/nodemailer/templates";
import { PASSWORD_RESET_EMAIL_TEMPLATE } from "@/lib/nodemailer/reset-template";
import { VERIFY_EMAIL_TEMPLATE } from "@/lib/nodemailer/verify-template";

/**
 * Outbound mail, gated on SMTP actually being configured.
 *
 * v1 read `NODEMAILER_EMAIL`/`NODEMAILER_PASSWORD` straight from `process.env`
 * and hardcoded `service: "gmail"`, so with no credentials present it built a
 * transport with `undefined` user and password and failed at send time. Meanwhile
 * `config.email()` was already written to return `null` when SMTP is absent,
 * precisely so local development works without it. This module honours that: no
 * credentials means mail is skipped and logged, and sign-up still completes.
 */

const FROM_NAME = BRAND.name;

let cached: Transporter | null = null;

function transport(): Transporter | null {
  const smtp = config.email();
  if (!smtp) return null;
  if (cached) return cached;
  cached = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    // 465 is implicit TLS; 587 upgrades via STARTTLS.
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.password },
  });
  return cached;
}

async function send(to: string, subject: string, html: string): Promise<void> {
  const smtp = config.email();
  const mailer = transport();
  if (!smtp || !mailer) {
    console.info(`mail.skipped subject="${subject}" reason=smtp-not-configured`);
    return;
  }
  try {
    await mailer.sendMail({
      from: `"${FROM_NAME}" <${smtp.user}>`,
      to,
      subject,
      html,
    });
  } catch (error) {
    // A failed notification must never fail the action that triggered it: a
    // user whose welcome mail bounced still has an account.
    console.error(`mail.failed subject="${subject}"`, error);
  }
}

const fill = (template: string, values: Record<string, string>): string =>
  Object.entries(values).reduce(
    (html, [key, value]) => html.replaceAll(`{{${key}}}`, value),
    template,
  );

export async function sendWelcomeEmail(args: {
  email: string;
  name: string;
  intro: string;
}): Promise<void> {
  await send(
    args.email,
    `Welcome to ${BRAND.name}`,
    fill(WELCOME_EMAIL_TEMPLATE, { name: args.name, intro: args.intro }),
  );
}

export async function sendPasswordResetEmail(args: {
  email: string;
  name: string;
  url: string;
}): Promise<void> {
  await send(
    args.email,
    `Reset your ${BRAND.name} password`,
    fill(PASSWORD_RESET_EMAIL_TEMPLATE, { name: args.name, url: args.url }),
  );
}

export async function sendVerificationEmail(args: {
  email: string;
  name: string;
  url: string;
}): Promise<void> {
  await send(
    args.email,
    `Verify your ${BRAND.name} email`,
    fill(VERIFY_EMAIL_TEMPLATE, { name: args.name, url: args.url }),
  );
}

import { config } from "@/core/config/env";
import type { Messenger } from "./index";

/**
 * WhatsApp delivery via Twilio REST API (no SDK — avoids a heavy dependency).
 * Numbers must be prefixed "whatsapp:+<country_code><number>".
 * Sandbox from: whatsapp:+14155238886 (join sandbox first at console.twilio.com)
 * Production from: your verified WhatsApp Business number.
 */
export class TwilioMessenger implements Messenger {
  async send(to: string, message: string): Promise<void> {
    const { accountSid, authToken, from } = config.twilio();
    if (!accountSid || !authToken) {
      throw new Error("Twilio credentials not configured.");
    }

    const normalizedTo = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;

    const body = new URLSearchParams({
      From: from,
      To: normalizedTo,
      Body: message,
    });

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      },
    );

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(`Twilio error ${res.status}: ${err.message ?? res.statusText}`);
    }
  }
}

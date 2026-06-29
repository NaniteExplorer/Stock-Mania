/**
 * Messaging abstraction for WhatsApp / SMS alerts.
 *
 * Ships with a NoOpMessenger so the app works with zero credentials today.
 * SCALE: set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN to switch to TwilioMessenger
 * — no call-site changes needed.
 */
export interface Messenger {
  send(to: string, message: string): Promise<void>;
}

class NoOpMessenger implements Messenger {
  async send(to: string, message: string): Promise<void> {
    console.info(`[messenger:noop] Would send to ${to}: ${message.slice(0, 60)}…`);
  }
}

const _global = globalThis as unknown as { _smMessenger?: Messenger };

async function resolveImpl(): Promise<Messenger> {
  if (_global._smMessenger) return _global._smMessenger;
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    const { TwilioMessenger } = await import("./twilio");
    _global._smMessenger = new TwilioMessenger();
  } else {
    _global._smMessenger = new NoOpMessenger();
  }
  return _global._smMessenger;
}

export const messenger: Messenger = {
  send: (to, msg) => resolveImpl().then((m) => m.send(to, msg)),
};

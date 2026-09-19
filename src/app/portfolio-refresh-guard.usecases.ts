export type RefreshGuardDenial = "COOLDOWN" | "IN_PROGRESS" | "INSTRUMENT_BUDGET_EXCEEDED";

export type RefreshGuardDecision =
  | { readonly ok: true; readonly release: () => void }
  | { readonly ok: false; readonly reason: RefreshGuardDenial; readonly retryAfterSeconds: number | null };

/** Process-local protection around explicit, user-triggered provider refreshes. */
export class PortfolioRefreshGuard {
  private readonly inFlight = new Map<string, boolean>();
  private readonly lastStartedAt = new Map<string, number>();

  constructor(
    private readonly options: {
      readonly cooldownMillis: number;
      readonly maxInstruments: number;
      readonly now?: () => number;
    } = { cooldownMillis: 30_000, maxInstruments: 250 },
  ) {}

  acquire(userKey: string, instrumentCount: number): RefreshGuardDecision {
    if (instrumentCount > this.options.maxInstruments) {
      return { ok: false, reason: "INSTRUMENT_BUDGET_EXCEEDED", retryAfterSeconds: null };
    }
    if (this.inFlight.get(userKey) === true) {
      return { ok: false, reason: "IN_PROGRESS", retryAfterSeconds: null };
    }

    const now = (this.options.now ?? Date.now)();
    const lastStartedAt = this.lastStartedAt.get(userKey);
    if (lastStartedAt !== undefined) {
      const remaining = this.options.cooldownMillis - (now - lastStartedAt);
      if (remaining > 0) {
        return { ok: false, reason: "COOLDOWN", retryAfterSeconds: Math.ceil(remaining / 1_000) };
      }
    }

    this.inFlight.set(userKey, true);
    this.lastStartedAt.set(userKey, now);
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        this.inFlight.set(userKey, false);
      },
    };
  }
}

export const portfolioRefreshGuard = new PortfolioRefreshGuard();

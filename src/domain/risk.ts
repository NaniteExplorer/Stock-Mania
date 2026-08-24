/**
 * The pre-trade risk gate — the one item in the plan that can lose real money.
 *
 * The plan's instruction is unusually blunt: implement all eight checks with
 * fail-closed semantics and an idempotency key, **or disable the live order path
 * until they exist**. This file takes the first option, and the reason it exists
 * before any broker adapter does is that the order matters. A gate written after
 * an order path is a gate something already bypasses.
 *
 * **Fail-closed** is the whole design. Every check returns a verdict, and anything
 * that is not an explicit `ALLOW` blocks the order — including a check that threw,
 * a check whose input was missing, and a check nobody has implemented yet. The
 * usual shape (a list of validators that push errors, and an order that proceeds if
 * the list is empty) fails *open* the moment a validator throws before it pushes,
 * which is precisely when you least want it to.
 *
 * There is deliberately **no broker adapter in this codebase**. `OrderIntent` goes
 * to `RiskGate.evaluate`, and the only thing that can come out is a decision;
 * nothing here can place an order, and `tests/risk.spec.ts` asserts that no module
 * anywhere in `src/` talks to a broker. When one arrives, it must take an
 * `ApprovedOrder`, which only the gate can mint.
 */

import { Money } from "@/core/money";
import { Percentage, Quantity } from "@/core/numeric";
import { CalendarDate } from "@/core/time";

/* ═══ Intent ══════════════════════════════════════════════════════════ */

export type OrderSide = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT";

/**
 * What the user asked for, before anything has been checked.
 *
 * `idempotencyKey` is required, not optional — invariant I05. A duplicate order is
 * one of the two ways an automated path loses money (the other is a fat finger),
 * and it happens on a retry after a timeout, when the first order has in fact
 * reached the exchange. A key the caller must supply is the only defence, because
 * the app cannot tell a retry from a second deliberate order without one.
 */
export interface OrderIntent {
  readonly idempotencyKey: string;
  readonly requestedOn: CalendarDate;
  readonly instrumentId: string;
  readonly symbol: string;
  readonly side: OrderSide;
  readonly orderType: OrderType;
  readonly quantity: Quantity;
  /** Required for a limit order; a market order has none, which is why it is risky. */
  readonly limitPrice: Money | null;
  /** The last price seen, for the fat-finger check. */
  readonly referencePrice: Money | null;
}

/* ═══ Limits ══════════════════════════════════════════════════════════ */

/**
 * The limits the gate checks against.
 *
 * Every one is a *configured* number rather than a constant, because every one is a
 * judgement about the user's own tolerance — and a shipped default would be a
 * judgement about someone the author has never met. The absence of a limit is not
 * permission: {@link RiskGate} treats a missing limit as a blocked order, which is
 * the fail-closed rule applied to configuration.
 */
export interface RiskLimits {
  /** Largest position in one instrument, as a share of portfolio value. */
  readonly maxPositionShare: Percentage | null;
  /** Largest exposure to one sector or asset class. */
  readonly maxExposureShare: Percentage | null;
  /** Largest single order, in money. */
  readonly maxOrderValue: Money | null;
  /** How far from the reference price an order may be before it looks like a typo. */
  readonly fatFingerTolerance: Percentage | null;
  /** Realised plus unrealised loss for the day at which trading stops. */
  readonly maxDailyLoss: Money | null;
  /** Orders allowed per rolling window. */
  readonly maxOrdersPerWindow: number | null;
  readonly windowMinutes: number | null;
  /** When true, nothing is allowed. The one check that is *supposed* to block. */
  readonly killSwitchEngaged: boolean;
  /** Margin available; a buy needs its value covered. */
  readonly availableMargin: Money | null;
}

/** The portfolio state the checks need. Supplied, never fetched — this file is pure. */
export interface RiskContext {
  readonly portfolioValue: Money;
  /** Current value of the position this order touches. */
  readonly positionValue: Money;
  /** Current value of the exposure group (sector, asset class) it belongs to. */
  readonly exposureValue: Money;
  /** Realised plus unrealised loss so far today, as a positive number. */
  readonly lossToday: Money;
  /** Orders already placed inside the rolling window. */
  readonly ordersInWindow: number;
  /** Whether this idempotency key has been seen. */
  readonly keyAlreadyUsed: boolean;
  /** Units held, for a sell. */
  readonly unitsHeld: Quantity;
}

/* ═══ Verdicts ════════════════════════════════════════════════════════ */

export type CheckId =
  | "POSITION_LIMIT"
  | "EXPOSURE_LIMIT"
  | "ORDER_SIZE"
  | "FAT_FINGER"
  | "DAILY_LOSS"
  | "RATE_LIMIT"
  | "KILL_SWITCH"
  | "MARGIN"
  | "IDEMPOTENCY"
  | "SHORT_SELL";

export type Verdict = "ALLOW" | "BLOCK";

export interface CheckResult {
  readonly check: CheckId;
  readonly verdict: Verdict;
  /** Always populated, including on an allow — a gate that only explains refusals is not auditable. */
  readonly because: string;
}

export interface Decision {
  readonly allowed: boolean;
  readonly results: readonly CheckResult[];
  readonly blockedBy: readonly CheckId[];
  /** One line for the user, from the first block. */
  readonly message: string;
}

/**
 * An order that passed the gate.
 *
 * A nominal type: the only way to obtain one is {@link RiskGate.approve}, so a
 * broker adapter that takes an `ApprovedOrder` cannot be called with a bare
 * intent. That is the difference between a gate and a convention — a convention is
 * something the next caller in a hurry skips.
 */
export interface ApprovedOrder {
  readonly intent: OrderIntent;
  readonly decision: Decision;
  readonly approvedAt: CalendarDate;
  readonly __approvedByGate: unique symbol;
}

/* ═══ The gate ════════════════════════════════════════════════════════ */

/** The eight checks the plan names, plus idempotency and the short-sell guard. */
export const ALL_CHECKS: readonly CheckId[] = [
  "KILL_SWITCH",
  "IDEMPOTENCY",
  "ORDER_SIZE",
  "FAT_FINGER",
  "POSITION_LIMIT",
  "EXPOSURE_LIMIT",
  "DAILY_LOSS",
  "RATE_LIMIT",
  "MARGIN",
  "SHORT_SELL",
];

export class RiskGate {
  constructor(private readonly limits: RiskLimits) {}

  /**
   * Runs every check and returns a decision.
   *
   * Every check runs even after one blocks, deliberately: a user whose order
   * breaches three limits should be told all three rather than fixing them one
   * refusal at a time. A check that throws is caught and recorded as a `BLOCK`
   * with the error in its reason — an exception is not permission.
   */
  evaluate(intent: OrderIntent, context: RiskContext): Decision {
    const results: CheckResult[] = [];

    for (const check of ALL_CHECKS) {
      try {
        results.push(this.run(check, intent, context));
      } catch (error) {
        results.push({
          check,
          verdict: "BLOCK",
          because:
            `The ${check} check failed to run (${(error as Error).message}). An order is blocked ` +
            `when a check cannot be completed — a gate that let orders through on error would ` +
            `fail open exactly when something is wrong.`,
        });
      }
    }

    const blockedBy = results.filter((result) => result.verdict === "BLOCK").map((result) => result.check);
    const firstBlock = results.find((result) => result.verdict === "BLOCK");

    return {
      allowed: blockedBy.length === 0,
      results,
      blockedBy,
      message: firstBlock ? firstBlock.because : "Every pre-trade check passed.",
    };
  }

  /**
   * Approves an order, or returns the decision that refused it.
   *
   * The only constructor of {@link ApprovedOrder}. A caller that wants to place an
   * order has to hold the result of this call, and there is no other way to make
   * the type.
   */
  approve(
    intent: OrderIntent,
    context: RiskContext,
  ): { readonly ok: true; readonly order: ApprovedOrder } | { readonly ok: false; readonly decision: Decision } {
    const decision = this.evaluate(intent, context);
    if (!decision.allowed) return { ok: false, decision };
    return {
      ok: true,
      order: {
        intent,
        decision,
        approvedAt: intent.requestedOn,
      } as ApprovedOrder,
    };
  }

  private run(check: CheckId, intent: OrderIntent, context: RiskContext): CheckResult {
    switch (check) {
      case "KILL_SWITCH":
        return this.limits.killSwitchEngaged
          ? block(check, "The kill switch is engaged. Nothing is placed until it is released.")
          : allow(check, "The kill switch is off.");

      case "IDEMPOTENCY":
        if (intent.idempotencyKey.trim() === "") {
          return block(check, "An order without an idempotency key cannot be de-duplicated (I05).");
        }
        return context.keyAlreadyUsed
          ? block(
              check,
              `An order with key ${intent.idempotencyKey} has already been placed. This is a ` +
                `retry, not a second order — the first one may already be at the exchange.`,
            )
          : allow(check, "The idempotency key is new.");

      case "ORDER_SIZE": {
        const limit = this.limits.maxOrderValue;
        if (!limit) return block(check, "No maximum order value is configured, so no order is allowed.");
        const value = this.orderValue(intent);
        if (!value) return block(check, "The order has no price to size it by.");
        return value.isGreaterThan(limit)
          ? block(check, `The order is ${value.toString()}, above the ${limit.toString()} limit.`)
          : allow(check, `${value.toString()} is within the ${limit.toString()} limit.`);
      }

      case "FAT_FINGER": {
        const tolerance = this.limits.fatFingerTolerance;
        if (!tolerance) return block(check, "No fat-finger tolerance is configured.");
        if (intent.orderType === "MARKET") {
          return allow(check, "A market order has no price to mistype.");
        }
        if (!intent.limitPrice || !intent.referencePrice) {
          return block(check, "A limit order needs both a limit price and a reference price to check.");
        }
        if (intent.referencePrice.isZero) {
          return block(check, "The reference price is zero, so the deviation cannot be computed.");
        }
        const deviation = Percentage.ratio(
          intent.limitPrice.minus(intent.referencePrice).abs(),
          intent.referencePrice,
        );
        return deviation.toScaledNumber() > tolerance.toScaledNumber()
          ? block(
              check,
              `The limit price is ${deviation.toFixed(1)}% from the last price of ` +
                `${intent.referencePrice.toString()}, beyond the ${tolerance.toFixed(1)}% tolerance. ` +
                `This is usually a decimal point in the wrong place.`,
            )
          : allow(check, `The limit is ${deviation.toFixed(1)}% from the last price.`);
      }

      case "POSITION_LIMIT": {
        const share = this.limits.maxPositionShare;
        if (!share) return block(check, "No maximum position share is configured.");
        if (intent.side === "SELL") return allow(check, "Selling reduces a position.");
        const value = this.orderValue(intent);
        if (!value) return block(check, "The order has no price, so the resulting position is unknown.");
        if (context.portfolioValue.isZero) {
          return block(check, "The portfolio has no value to measure a position share against.");
        }
        const after = Percentage.ratio(context.positionValue.plus(value), context.portfolioValue.plus(value));
        return after.toScaledNumber() > share.toScaledNumber()
          ? block(
              check,
              `This would make ${intent.symbol} ${after.toFixed(1)}% of the portfolio, above the ` +
                `${share.toFixed(1)}% limit.`,
            )
          : allow(check, `${intent.symbol} would be ${after.toFixed(1)}% of the portfolio.`);
      }

      case "EXPOSURE_LIMIT": {
        const share = this.limits.maxExposureShare;
        if (!share) return block(check, "No maximum exposure share is configured.");
        if (intent.side === "SELL") return allow(check, "Selling reduces an exposure.");
        const value = this.orderValue(intent);
        if (!value) return block(check, "The order has no price, so the resulting exposure is unknown.");
        if (context.portfolioValue.isZero) {
          return block(check, "The portfolio has no value to measure an exposure share against.");
        }
        const after = Percentage.ratio(context.exposureValue.plus(value), context.portfolioValue.plus(value));
        return after.toScaledNumber() > share.toScaledNumber()
          ? block(check, `This would take the group to ${after.toFixed(1)}%, above ${share.toFixed(1)}%.`)
          : allow(check, `The group would be ${after.toFixed(1)}% of the portfolio.`);
      }

      case "DAILY_LOSS": {
        const limit = this.limits.maxDailyLoss;
        if (!limit) return block(check, "No daily loss limit is configured.");
        return context.lossToday.isGreaterThanOrEqual(limit)
          ? block(
              check,
              `Today's loss is ${context.lossToday.toString()}, at or beyond the ` +
                `${limit.toString()} limit. Trading stops for the day.`,
            )
          : allow(check, `Today's loss is ${context.lossToday.toString()}, within the limit.`);
      }

      case "RATE_LIMIT": {
        const limit = this.limits.maxOrdersPerWindow;
        const window = this.limits.windowMinutes;
        if (limit === null || window === null) {
          return block(check, "No order rate limit is configured.");
        }
        return context.ordersInWindow >= limit
          ? block(
              check,
              `${context.ordersInWindow} orders in the last ${window} minutes, at the limit of ` +
                `${limit}. A burst of orders is what a runaway loop looks like.`,
            )
          : allow(check, `${context.ordersInWindow} of ${limit} orders used in this window.`);
      }

      case "MARGIN": {
        if (intent.side === "SELL") return allow(check, "A sale needs no margin.");
        const margin = this.limits.availableMargin;
        if (!margin) return block(check, "Available margin is unknown, so no buy is allowed.");
        const value = this.orderValue(intent);
        if (!value) return block(check, "The order has no price to fund.");
        return value.isGreaterThan(margin)
          ? block(check, `The order needs ${value.toString()} against ${margin.toString()} available.`)
          : allow(check, `${margin.toString()} is available for a ${value.toString()} order.`);
      }

      case "SHORT_SELL":
        if (intent.side === "BUY") return allow(check, "A purchase cannot go short.");
        return intent.quantity.isGreaterThan(context.unitsHeld)
          ? block(
              check,
              `The order sells ${intent.quantity.toDecimalString()} against ` +
                `${context.unitsHeld.toDecimalString()} held. Short selling is not supported (P04).`,
            )
          : allow(check, `${context.unitsHeld.toDecimalString()} units are held.`);
    }
  }

  /** Value of the order, when it has a price. `null` for an unpriced market order. */
  private orderValue(intent: OrderIntent): Money | null {
    const price = intent.limitPrice ?? intent.referencePrice;
    return price ? intent.quantity.valueAt(price, "HALF_UP") : null;
  }
}

function allow(check: CheckId, because: string): CheckResult {
  return { check, verdict: "ALLOW", because };
}

function block(check: CheckId, because: string): CheckResult {
  return { check, verdict: "BLOCK", because };
}

/**
 * Limits with nothing configured — every order blocked.
 *
 * The default a new user starts with, and it is not a placeholder: an account with
 * no configured limits is an account whose owner has not said what they consider
 * safe, and guessing on their behalf is how an automated path loses money the
 * first time it is left alone.
 */
export function noLimits(): RiskLimits {
  return {
    maxPositionShare: null,
    maxExposureShare: null,
    maxOrderValue: null,
    fatFingerTolerance: null,
    maxDailyLoss: null,
    maxOrdersPerWindow: null,
    windowMinutes: null,
    killSwitchEngaged: true,
    availableMargin: null,
  };
}

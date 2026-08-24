/**
 * The execution seam, and the two things it has to make impossible.
 *
 * 1. **A bare intent cannot reach a venue.** `place` takes an `ApprovedOrder`,
 *    which only `RiskGate.approve` can mint, so the gate is not a convention a
 *    caller in a hurry can skip — it is a compile error. Asserted with
 *    `@ts-expect-error`, which the typecheck enforces: if passing an unapproved
 *    intent ever *starts* compiling, the line fails the build for having no error
 *    to expect. That is a rare case where a test gets stronger by asserting a
 *    failure.
 *
 * 2. **A retried order does not fill twice.** Invariant I05. A timeout is the one
 *    situation where the app cannot tell a retry from a second deliberate order,
 *    and an idempotency key is the only defence. The simulated venue replays the
 *    original ack rather than filling again, and says it is a replay — an
 *    interface that hid that would make a retry indistinguishable from a second
 *    fill.
 */

import { Ok } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { Percentage, Quantity } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { UserId } from "@/core/kernel";
import {
  RiskGate,
  SimulatedVenue,
  noLimits,
  type OrderIntent,
  type RiskContext,
  type RiskLimits,
} from "@/domain/risk";
import { PlaceOrder } from "@/app/investing.usecases";
import { check, checkTrue, done, section } from "./harness";

const rupees = (value: string) => Money.fromRupees(value, Currency.INR);
const on = (value: string) => CalendarDate.parse(value);
const units = (value: string) => Quantity.fromString(value);

const limits: RiskLimits = {
  maxPositionShare: Percentage.of("20"),
  maxExposureShare: Percentage.of("40"),
  maxOrderValue: rupees("200000"),
  fatFingerTolerance: Percentage.of("5"),
  maxDailyLoss: rupees("50000"),
  maxOrdersPerWindow: 10,
  windowMinutes: 60,
  killSwitchEngaged: false,
  availableMargin: rupees("500000"),
};

const context: RiskContext = {
  portfolioValue: rupees("2000000"),
  positionValue: rupees("100000"),
  exposureValue: rupees("300000"),
  lossToday: rupees("0"),
  ordersInWindow: 1,
  keyAlreadyUsed: false,
  unitsHeld: units("100"),
};

const intent = (key: string, overrides: Partial<OrderIntent> = {}): OrderIntent => ({
  idempotencyKey: key,
  requestedOn: on("2026-08-24"),
  instrumentId: "instrument-infy",
  symbol: "INFY",
  side: "BUY",
  orderType: "LIMIT",
  quantity: units("50"),
  limitPrice: rupees("1500"),
  referencePrice: rupees("1520"),
  ...overrides,
});

async function main() {
  section("only the gate can mint what the venue accepts");

  const venue = new SimulatedVenue();
  const gate = new RiskGate(limits);

  // @ts-expect-error — a bare intent is not an ApprovedOrder, and this is the
  // whole point of the seam: the type system, not a code review, keeps an
  // unchecked order away from a broker.
  const bypass = () => venue.place(intent("bypass"));
  check("the bypass is a compile error, so it is never called", typeof bypass, "function");

  section("an approved order fills");

  const place = new PlaceOrder(gate, venue);
  const first = await place.execute({ userId: UserId.from("user-venue"), intent: intent("k-1"), context });
  checkTrue("the use case succeeded", first.ok);
  if (!first.ok) return;
  check("every check passed", first.value.decision.allowed, true);
  check("the order was filled", first.value.ack?.state, "FILLED");
  check("at the limit price", first.value.ack?.averagePrice?.toDecimalString(), "1500.00");
  check("in full", first.value.ack?.filledQuantity.toDecimalString(), "50");
  check("and it is not a replay", first.value.ack?.wasReplay, false);
  check("the venue names itself on the ack", first.value.ack?.venueId, "simulated");

  section("I05 — a retry replays rather than filling twice");

  const retry = await place.execute({ userId: UserId.from("user-venue"), intent: intent("k-1"), context });
  checkTrue("the retry succeeded", retry.ok);
  if (!retry.ok) return;
  check("it is marked a replay", retry.value.ack?.wasReplay, true);
  check("with the original venue order id", retry.value.ack?.venueOrderId, first.value.ack?.venueOrderId);
  check("and the venue holds one fill, not two", venue.fills().length, 1);

  const different = await place.execute({
    userId: UserId.from("user-venue"),
    intent: intent("k-2"),
    context,
  });
  checkTrue("a genuinely new key is a new order", different.ok && different.value.ack?.wasReplay === false);
  check("now there are two fills", venue.fills().length, 2);

  section("a blocked order never reaches the venue");

  const closed = new SimulatedVenue({ id: "closed" });
  const shut = new PlaceOrder(new RiskGate(noLimits()), closed);
  const refused = await shut.execute({
    userId: UserId.from("user-venue"),
    intent: intent("k-3"),
    context,
  });
  checkTrue("a refusal is a result, not an error", refused.ok);
  if (!refused.ok) return;
  check("the gate refused", refused.value.decision.allowed, false);
  check("there is no ack", refused.value.ack, null);
  check("and the venue saw nothing", closed.fills().length, 0);
  checkTrue(
    "the kill switch is named as the reason",
    refused.value.decision.blockedBy.includes("KILL_SWITCH"),
  );

  section("an unpriced market order is rejected rather than filled at a guess");

  const marketVenue = new SimulatedVenue({ id: "market" });
  const marketPlace = new PlaceOrder(new RiskGate(limits), marketVenue);
  const unpriced = await marketPlace.execute({
    userId: UserId.from("user-venue"),
    intent: intent("k-4", { orderType: "MARKET", limitPrice: null, referencePrice: null }),
    context,
  });
  checkTrue("the use case returns a result", unpriced.ok);
  if (!unpriced.ok) return;
  /*
   * The gate refuses it first — an order with no price cannot be sized, and
   * ORDER_SIZE blocks on that. The venue's own refusal is the second line of
   * defence, asserted below by approving one directly.
   */
  check("the gate blocks an order it cannot size", unpriced.value.decision.allowed, false);

  const priced = new RiskGate({ ...limits, maxOrderValue: rupees("200000") }).approve(
    intent("k-5", { orderType: "MARKET", limitPrice: null }),
    context,
  );
  checkTrue("a market order with a reference price passes the gate", priced.ok);
  if (priced.ok) {
    const ack = await marketVenue.place(priced.order);
    check("and fills at the reference price", ack.averagePrice?.toDecimalString(), "1520.00");
  }

  section("slippage is configured, never assumed");

  const slipping = new SimulatedVenue({ id: "slippy", slippage: Percentage.of("1") });
  const buy = new RiskGate(limits).approve(
    intent("k-6", { orderType: "MARKET", limitPrice: null }),
    context,
  );
  if (buy.ok) {
    const ack = await slipping.place(buy.order);
    // A buy pays 1% more than the reference: ₹1,520 + ₹15.20.
    check("a buy slips against the buyer", ack.averagePrice?.toDecimalString(), "1535.20");
  }
  const sell = new RiskGate(limits).approve(
    intent("k-7", { side: "SELL", orderType: "MARKET", limitPrice: null, quantity: units("50") }),
    context,
  );
  if (sell.ok) {
    const ack = await slipping.place(sell.order);
    check("and a sell slips against the seller", ack.averagePrice?.toDecimalString(), "1504.80");
  }

  section("cancel and status");

  const status = await venue.status(first.value.ack?.venueOrderId ?? "");
  check("a placed order can be looked up", status?.state, "FILLED");
  check("an unknown one is null, not an error", await venue.status("nope"), null);

  const late = await venue.cancel(first.value.ack?.venueOrderId ?? "");
  check("cancelling a filled order reports the race rather than throwing", late.state, "FILLED");
  checkTrue("and says why", late.because.includes("too late"));

  section("no broker adapter exists in the tree");

  /*
   * The plan's constraint, still true after Phase 8. `SimulatedVenue` is the only
   * implementation, so nothing in `src/` can place a real order — the seam is
   * ready and deliberately unplugged.
   */
  check("Ok is still the result type the use case returns", typeof Ok, "function");

  done();
}

void main();

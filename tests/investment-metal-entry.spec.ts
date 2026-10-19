import { readFileSync } from "node:fs";
import { check, checkTrue, done, section } from "./harness";
import {
  METAL_LANES,
  formatMinor,
  isPurityOf,
  metalDisplayName,
  metalLane,
  metalPricing,
} from "../app/(root)/investments/new/metal-identity";
import {
  ENTRY_LANES,
  entryLane,
  normalizeEntryLane,
} from "../app/(root)/investments/new/entry-lane-nav";

section("entry lanes");

check("default lane is the listed catalogue", normalizeEntryLane(undefined), "market");
check("unknown lane falls back", normalizeEntryLane("nonsense"), "market");
check("metal lane is addressable", normalizeEntryLane("metal"), "metal");
check("array params take the first value", normalizeEntryLane(["manual", "metal"]), "manual");
check("every lane is labelled", ENTRY_LANES.filter((lane) => lane.label.trim() === "").length, 0);
check("lane lookup is total", entryLane("metal").id, "metal");

section("metal identity");

check("three metals are offered", METAL_LANES.length, 3);
check(
  "every metal has at least one purity",
  METAL_LANES.filter((lane) => lane.purities.length === 0).length,
  0,
);
check("gold offers both fine grades", metalLane("DIGITAL_GOLD").purities.length, 2);
checkTrue("999 belongs to gold", isPurityOf("DIGITAL_GOLD", "GOLD999"));
checkTrue("995 belongs to gold", isPurityOf("DIGITAL_GOLD", "GOLD995"));

/*
 * The whitelist is the only thing standing between a POST and an invented quote
 * key, which is the failure the manual tier exists to avoid: a stored key no
 * source accepts prices the holding at nothing, forever, with nothing to point
 * at. So a silver purity on a gold row, and anything not on the list at all,
 * both have to be refused rather than merely unavailable in the dropdown.
 */
checkTrue("silver purity is not a gold purity", !isPurityOf("DIGITAL_GOLD", "SILVER999"));
checkTrue("an invented key is refused", !isPurityOf("DIGITAL_GOLD", "GOLD"));
checkTrue("an empty key is refused", !isPurityOf("DIGITAL_SILVER", ""));

check(
  "the name carries the platform",
  metalDisplayName("DIGITAL_GOLD", "SafeGold"),
  "Digital gold - SafeGold",
);
check(
  "whitespace-only platform is no platform",
  metalDisplayName("DIGITAL_SILVER", "   "),
  "Digital silver",
);

section("pricing a metal entry from the receipt");

/*
 * The receipt that broke the first version: 0.3481g for ₹5,000 with ₹150 GST
 * implies ₹13,932.777 per gram, and the form asked for that rate — which a
 * trade price, being paise, can never hold. So the amount is the input now and
 * the rate is derived. The claim that matters is that the cash impact equals
 * the number the user typed, because that is what will leave the books.
 */
const buy = metalPricing({ side: "BUY", grams: "0.3481", total: "5000", charges: ["0", "150"] });
checkTrue("a real receipt prices", buy.ok);
if (buy.ok) {
  check("the gold itself cost the total less GST", formatMinor(buy.value.considerationMinor), "4850.00");
  check("which works out per gram", formatMinor(buy.value.ratePerGramMinor), "13932.78");
  check("and the cash impact is the receipt total", formatMinor(buy.value.signedMinor), "-5000.00");
}

/* Sale charges come out of the proceeds, so the gross is the total plus them
   and the cash in is the total again — symmetry, in both directions. */
const sale = metalPricing({ side: "SELL", grams: "2", total: "14000", charges: ["50", "0"] });
checkTrue("a sale prices", sale.ok);
if (sale.ok) {
  check("the gross is the total plus charges", formatMinor(sale.value.considerationMinor), "14050.00");
  check("at a per-gram rate", formatMinor(sale.value.ratePerGramMinor), "7025.00");
  check("and the cash received is the total", formatMinor(sale.value.signedMinor), "14000.00");
}

checkTrue(
  "charges cannot swallow the whole purchase",
  !metalPricing({ side: "BUY", grams: "1", total: "100", charges: ["100"] }).ok,
);
checkTrue(
  "zero grams is refused rather than divided by",
  !metalPricing({ side: "BUY", grams: "0", total: "100", charges: [] }).ok,
);
checkTrue(
  "a blank amount is refused",
  !metalPricing({ side: "BUY", grams: "1", total: "", charges: [] }).ok,
);
/* Eight-decimal grams are what a ₹100 purchase actually credits. */
/*
 * A receipt gets copied, not retyped. Rejecting "5,000" or "0.3481 g" made the
 * form look broken for input that was never ambiguous, and the user could not
 * tell which of the two fields the refusal was even about.
 */
const pasted = metalPricing({
  side: "BUY",
  grams: "0.3481 g",
  total: "₹ 5,000",
  charges: ["0", "150"],
});
checkTrue("a pasted receipt figure still prices", pasted.ok);
if (pasted.ok) {
  check("to the same rupees", formatMinor(pasted.value.signedMinor), "-5000.00");
}
/* Three decimals on an amount is a rate, not rupees — the mistake that made
   every submission bounce. It has to be refused, and say so. */
const rateInTotal = metalPricing({ side: "BUY", grams: "0.3481", total: "13932.777", charges: [] });
checkTrue("a per-gram rate typed as the total is refused", !rateInTotal.ok);
if (!rateInTotal.ok) {
  checkTrue(
    "and the refusal says which number is wanted",
    rateInTotal.message.includes("not the rate per gram"),
  );
}

checkTrue(
  "tiny purchases still price",
  metalPricing({ side: "BUY", grams: "0.00712345", total: "100", charges: ["2.91"] }).ok,
);

section("metal entry form wiring");

const form = readFileSync("app/(root)/investments/new/record-metal-form.tsx", "utf8");

checkTrue("posts on the metal identity mode", form.includes('name="identityMode" value="METAL"'));
/* The bare slug: AddInstrument qualifies it per platform and pins quoteRef to
   the unqualified form, so pre-qualifying here would break pricing. */
checkTrue("submits the bare purity slug as the symbol", form.includes('name="symbol" value={purity}'));
checkTrue("sends the purity as the quote key", form.includes('name="quoteRef" value={purity}'));
checkTrue("is confirmed only once a platform is chosen", form.includes('value={identified ? "yes" : ""}'));
checkTrue("asks for grams, not a generic quantity", form.includes('label="Grams"'));
/* Asking for the rate rejected every real receipt; the amount is the input. */
checkTrue("asks for the receipt total, not the rate", form.includes('name="totalAmount"'));
checkTrue("does not ask for a rate per gram", !form.includes('name="unitPrice"'));
checkTrue("shows the derived rate back", form.includes("Works out at, per gram"));
/* Bullion has no verified schedule; offering one would be a guess presented as
   arithmetic. The equity-only controls must not leak into this lane. */
checkTrue("offers no charge estimate", !form.includes("estimateInvestmentCharges"));
checkTrue("offers no delivery/intraday segment", !form.includes('name="segment"'));
/* Metal is bought from money that was never a row here, so no funding account is
   asked for — and the lane says out loud that no cash balance moves, because a
   silent opening-balances leg is how the same rupees get counted twice. */
/* Buying asks for no account; selling must, because proceeds land somewhere
   real and there is no inverse of an opening position. */
checkTrue(
  "asks for no funding account on a purchase",
  form.includes('{side === "SELL" && (') && !form.includes('label={side === "BUY" ? "Paid from"'),
);
checkTrue("asks where sale proceeds land", form.includes('label="Proceeds to"'));
checkTrue(
  "says no money leaves an account when buying",
  form.includes("does not move money out of any account"),
);

section("metal lane reachable from the page");

const page = readFileSync("app/(root)/investments/new/page.tsx", "utf8");
checkTrue("the page renders the lane nav", page.includes("<EntryLaneNav"));
checkTrue("the metal lane renders the metal form", page.includes("<RecordMetalForm"));

const marketForm = readFileSync("app/(root)/investments/new/record-investment-form.tsx", "utf8");
checkTrue(
  "the catalogue combobox is confined to the market lane",
  marketForm.includes('{lane === "market" && <InstrumentSearch'),
);
checkTrue(
  "the manual lane still excludes the digital metals",
  !marketForm.includes('"DIGITAL_GOLD"'),
);

section("server whitelists the metal quote key");

const actions = readFileSync("app/(root)/investments/catalog-actions.ts", "utf8");
checkTrue("the action accepts the metal mode", actions.includes('"CATALOG", "MANUAL", "METAL"'));
checkTrue("it checks the purity against the metal", actions.includes("isPurityOf(kind, purity)"));
checkTrue("metals are INR only", actions.includes("Digital metals are recorded in INR."));
checkTrue("the server derives the rate itself", actions.includes("metalPricing({"));
/* The preview and the booked trade share one quantity and one price, so the
   number shown and the number posted cannot drift apart. */
checkTrue(
  "the preview is computed from the booked price",
  actions.includes("cashPreview(values, pricing.quantity, pricing.pricePerUnit, currency)"),
);
checkTrue(
  "metals fall back to opening balances",
  actions.includes("SystemAccountCodes.openingBalances"),
);
/* The fallback is scoped to metals: every other lane still has to name the
   account the money actually came from. */
checkTrue(
  "other lanes still require the cash account",
  actions.includes('groupOfKind(kind) !== "DIGITAL_METALS"'),
);
checkTrue(
  "a manual metal is refused rather than stored unpriced",
  actions.includes("Record digital metals in the metals lane"),
);
/* The ledger refuses a BUY out of opening balances (L06), so an account-free
   purchase has to be booked as an opening position instead. */
checkTrue("an account-free purchase opens a position", actions.includes("OpeningPosition.record("));
checkTrue("a sale still needs a destination", actions.includes("Choose the account the sale proceeds land in."));

done();

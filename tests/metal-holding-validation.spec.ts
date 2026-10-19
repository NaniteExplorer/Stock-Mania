import { readFileSync } from "node:fs";
import { checkTrue, done, section } from "./harness";

const actionSource = readFileSync("app/(root)/investments/actions.ts", "utf8");
const formSource = readFileSync(
  "app/(root)/investments/[instrumentId]/metal-holding-form.tsx",
  "utf8",
);
const schemaSource = sourceBetween(
  actionSource,
  "const metalHoldingSchema = z.object({",
  "/** Pulls a fresh rate",
);
const recordActionSource = sourceBetween(
  actionSource,
  "export async function recordMetalHoldingAction",
  "const metalMutationSchema",
);

section("digital-metal holding validation");

checkTrue(
  "legacy non-UUID instrument IDs follow the domain nonblank contract",
  schemaSource.includes('instrumentId: z.string().trim().min(1, "Investment holding not found.")') &&
    !schemaSource.includes("instrumentId: z.string().uuid()"),
);
checkTrue(
  "blank or malformed submitted dates are rejected at the validation edge",
  schemaSource.includes('recordedOn: z.string().trim().pipe(z.iso.date("Choose a valid date."))'),
);
checkTrue(
  "validation failures preserve flattened field errors",
  recordActionSource.includes("fieldErrors: z.flattenError(parsed.error).fieldErrors"),
);
checkTrue(
  "charges accept either an amount or an empty optional value",
  schemaSource.includes('charges: AMOUNT.optional().or(z.literal(""))'),
);
checkTrue(
  "the metal action passes exact consideration separately from rounded unit price",
  recordActionSource.includes("pricePerUnit: grams.perUnit(metalCost)") &&
    recordActionSource.includes("consideration: metalCost"),
);

section("field-level feedback");

for (const field of [
  "instrumentId",
  "grams",
  "invested",
  "charges",
  "fundingAccountId",
  "recordedOn",
]) {
  checkTrue(`${field} errors are rendered`, formSource.includes(`errors.${field}`));
}
checkTrue("the form still targets the existing metal holding action", formSource.includes("recordMetalHoldingAction"));
checkTrue("the hidden instrument identity is still submitted", formSource.includes('name="instrumentId" value={instrumentId}'));
for (const example of ["e.g. 5.2500", "e.g. 35000.00", "e.g. 1050.00"]) {
  checkTrue(`${example} is visibly an example`, formSource.includes(`placeholder="${example}"`));
}

done();

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  if (startIndex < 0 || endIndex < 0) return "";
  return source.slice(startIndex, endIndex);
}

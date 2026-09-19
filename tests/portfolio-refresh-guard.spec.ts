import { PortfolioRefreshGuard } from "@/app/portfolio-refresh-guard.usecases";
import { check, checkTrue, section } from "./harness";

section("portfolio refresh guard");

let now = 1_000_000;
const guard = new PortfolioRefreshGuard({ cooldownMillis: 30_000, maxInstruments: 2, now: () => now });

const first = guard.acquire("user-a", 2);
checkTrue("first bounded refresh is allowed", first.ok);
const concurrent = guard.acquire("user-a", 2);
check("same-user concurrent refresh is deduplicated", concurrent.ok ? "ALLOW" : concurrent.reason, "IN_PROGRESS");

const otherUser = guard.acquire("user-b", 2);
checkTrue("another tenant has an independent guard", otherUser.ok);
if (otherUser.ok) otherUser.release();

if (first.ok) {
  first.release();
  first.release();
}
const cooldown = guard.acquire("user-a", 2);
check("cooldown blocks provider hammering", cooldown.ok ? "ALLOW" : cooldown.reason, "COOLDOWN");
check("cooldown reports retry seconds", cooldown.ok ? null : cooldown.retryAfterSeconds, 30);

now += 30_000;
const afterCooldown = guard.acquire("user-a", 2);
checkTrue("refresh resumes after cooldown", afterCooldown.ok);
if (afterCooldown.ok) afterCooldown.release();

const oversized = guard.acquire("user-c", 3);
check("interactive instrument budget is bounded", oversized.ok ? "ALLOW" : oversized.reason, "INSTRUMENT_BUDGET_EXCEEDED");

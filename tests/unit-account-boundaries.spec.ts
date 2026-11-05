import { UserId } from "@/core/kernel";
import { Count, SortKey, type Polarity, type Sign } from "@/core/units";
import { Account, AccountCode, AccountHasPostingsError, AccountType, type AccountRepository } from "@/domain/accounts";
import { check, checkTrue, done, throws } from "./harness";

check("root depth counts one segment", AccountCode.parse("Assets").depth, Count(1));
check("nested depth counts path segments", AccountCode.parse("Assets:Bank:Savings").depth, Count(3));
for (const type of AccountType.all()) {
  const increasing: Sign = type.signedEffect(type.normalBalance);
  check(`${type.name} normal posting increases its balance`, increasing, 1);
  check(`${type.name} opposite posting decreases its balance`, type.signedEffect(type.normalBalance === "DEBIT" ? "CREDIT" : "DEBIT"), -1);
}
check("asset net worth sign stays positive", AccountType.ASSET.netWorthSign, 1);
check("liability net worth sign stays negative", AccountType.LIABILITY.netWorthSign, -1);
for (const type of [AccountType.INCOME, AccountType.EXPENSE, AccountType.EQUITY]) {
  check(`${type.name} remains excluded from net worth`, type.netWorthSign, 0);
}
const opening = { userId: UserId.from("unit-account-user"), code: AccountCode.parse("Assets:Test"), name: "Test", type: AccountType.ASSET };
const account = Account.open({ ...opening, sortOrder: SortKey(-5) });
check("aggregate delegates net worth sign", account.netWorthSign, 1);
check("signed sort keys lift an account above zero defaults", account.sortOrder, -5);
check("updating a signed sort key retains its value", account.updateDetails({ sortOrder: SortKey(-15) }).sortOrder, -15);
check("new account defaults to a valid zero sort key", Account.open(opening).sortOrder, 0);
check("copying preserves an existing signed sort key", account.rename("Renamed").sortOrder, -5);
check("rehydration retains a valid stored negative integer", Account.rehydrate(account).sortOrder, -5);
// Native JavaScript/persistence callers can evade compile-time brands. Every entry
// point still validates the same signed safe-integer invariant at runtime.
for (const invalid of [-0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
  throws(`open rejects invalid sort key ${invalid}`, () => Reflect.apply(Account.open, Account, [{ ...opening, sortOrder: invalid }]), "whole number");
  throws(`rehydrate rejects invalid sort key ${invalid}`, () => Reflect.apply(Account.rehydrate, Account, [{ ...account, sortOrder: invalid }]), "whole number");
  throws(`updateDetails rejects invalid sort key ${invalid}`, () => Reflect.apply(account.updateDetails, account, [{ sortOrder: invalid }]), "whole number");
}
checkTrue("posting count remains an exact deletion explanation", new AccountHasPostingsError("Test", Count(2)).message.includes("2 transaction(s)"));

if (false) {
  const depth: Count = AccountCode.parse("Assets").depth;
  const sign: Polarity = account.netWorthSign;
  const order: SortKey = account.sortOrder;
  // @ts-expect-error An arbitrary raw sort number must be validated at its boundary.
  Account.open({ ...opening, sortOrder: -5 });
  // @ts-expect-error A depth is a count, not an arbitrary raw number boundary.
  const invalidDepth: typeof depth = 1;
  // @ts-expect-error A posting count must identify its unit at the caller.
  new AccountHasPostingsError("Test", 2);
  // @ts-expect-error Repository posting counts cannot be arbitrary raw numbers.
  const invalidPostingCount: Awaited<ReturnType<AccountRepository["countPostings"]>> = 2;
  void [depth, sign, order, invalidDepth, invalidPostingCount];
}
done();

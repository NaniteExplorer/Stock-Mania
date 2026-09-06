import { revalidatePath } from "next/cache";
import { config } from "@/core/config";
import { UserId } from "@/core/kernel";
import { Currency } from "@/core/money";
import { CalendarDate, DateRange } from "@/core/time";
import type { IdentifierType, InstrumentRef, QuoteType } from "@/domain/pricing";
import { services } from "@/infra/container";
import { listMarketSyncUserIds } from "@/infra/market-sync-users";

export const runtime = "nodejs";
export const maxDuration = 60;

const IDENTIFIERS: Readonly<Record<string, IdentifierType>> = {
  TICKER: "TICKER",
  ISIN: "ISIN",
  AMFI_CODE: "SCHEME_CODE",
  SLUG: "METAL",
};

export async function GET(request: Request): Promise<Response> {
  const secret = config.marketData().cronSecret;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const userIds = await listMarketSyncUserIds();
  const report: { userId: string; persisted: number; warnings: string[] }[] = [];

  for (const rawUserId of userIds) {
    const userId = UserId.from(rawUserId);
    const app = services();
    const instruments = await app.repositories.instruments.list(userId, { includeClosed: false });
    const groups = new Map<QuoteType, InstrumentRef[]>();

    for (const instrument of instruments) {
      const key = instrument.quoteKey();
      const ref: InstrumentRef = {
        instrumentId: instrument.id.value,
        symbol: key.ref ?? instrument.symbol,
        assetClass: key.assetClass,
        currency: instrument.currency,
        identifierType: IDENTIFIERS[key.identifierType] ?? "TICKER",
      };
      const quoteType = key.quoteType as QuoteType;
      groups.set(quoteType, [...(groups.get(quoteType) ?? []), ref]);
    }

    let persisted = 0;
    const warnings: string[] = [];
    for (const [quoteType, refs] of groups) {
      const result = await app.pricing.refresh.execute({ instruments: refs, quoteType });
      if (result.ok) {
        persisted += result.value.persisted;
        warnings.push(...result.value.warnings);
      } else {
        warnings.push(result.error.message);
      }
    }

    const today = CalendarDate.parse(new Date().toISOString().slice(0, 10));
    const currencies = [...new Set(instruments
      .map((instrument) => instrument.currency.code)
      .filter((currency) => currency !== Currency.reporting.code))];
    for (const currency of currencies) {
      const fx = await app.pricing.fx.refresh(
        currency,
        [Currency.reporting.code],
        DateRange.of(today.plusDays(-7), today),
      );
      warnings.push(...fx.errors);
    }
    report.push({ userId: rawUserId, persisted, warnings });
  }

  revalidatePath("/investments");
  revalidatePath("/dashboard");
  return Response.json({
    ok: true,
    users: report.length,
    persisted: report.reduce((sum, item) => sum + item.persisted, 0),
    warnings: report.flatMap((item) => item.warnings).length,
    report,
  });
}

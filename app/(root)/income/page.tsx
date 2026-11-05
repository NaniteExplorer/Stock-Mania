import type { Metadata } from "next";
import { connection } from "next/server";
import { CalendarDate } from "@/core/time";
import { currentUserId, services } from "@/infra/container";
import { buildIncomeView } from "./income-model";
import { IncomeEmpty, IncomeScreen } from "./income-view";
import AddStreamForm from "./add-stream-form";

export const metadata: Metadata = { title: "Income" };

/** Income streams: what was expected, what arrived, and what is missing (DESIGN §9d). */
export default async function Page() {
  await connection();
  const userId = await currentUserId();
  const { clock, repositories } = services();
  const today = CalendarDate.parse(clock.today());

  const streams = await repositories.income.list(userId);
  if (streams.length === 0) return <IncomeEmpty form={<AddStreamForm />} />;

  const inputs = await Promise.all(streams.map(async (stream) => ({ stream, receipts: await repositories.income.receipts(userId, stream.id) })));
  return <IncomeScreen view={buildIncomeView(inputs, today)} form={<AddStreamForm />} />;
}

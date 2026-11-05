import type { Metadata } from "next";
import { connection } from "next/server";
import { currentUserId, services } from "@/infra/container";
import { CpiView } from "./cpi-view";
import CpiForm from "./cpi-form";
import RemoveCpiButton from "./remove-button";
import { recordCpiPointAction, removeCpiPointAction } from "./actions";
import { buildCpiRows, editValues } from "./cpi-model";

export const metadata: Metadata = { title: "CPI Urban" };

/**
 * Owner CPI entry (net-worth-age-chart.md § "CPI series"). A failed read throws
 * to this segment's error.tsx, which names it and offers Retry.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ edit?: string | string[] }> }) {
  await connection();
  const userId = await currentUserId();
  const loaded = await services().cpiSeries.load.execute({ userId });
  if (!loaded.ok) throw new Error(loaded.error.message);
  const points = loaded.value;
  const { edit } = await searchParams;
  const initial = editValues(points, typeof edit === "string" ? edit : undefined);
  const form = <CpiForm key={initial?.month ?? "new"} action={recordCpiPointAction} initial={initial} />;
  const remove = (row: { month: string; monthLabel: string }) => <RemoveCpiButton action={removeCpiPointAction} month={row.month} label={row.monthLabel} />;
  return <CpiView
    state={points.length === 0 ? { kind: "empty" } : { kind: "ready", rows: buildCpiRows(points) }}
    form={form} remove={remove} editing={initial?.month ?? null} />;
}

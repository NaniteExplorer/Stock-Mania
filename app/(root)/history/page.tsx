import type { Metadata } from "next";
import { getMySnapshots } from "@/features/tracking/snapshot.actions";
import HistoryManager from "@/components/wealth/HistoryManager";

export const metadata: Metadata = { title: "History" };

export default async function HistoryPage() {
  const snapshots = await getMySnapshots();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">Net worth history</h1>
        <p className="page-subtitle">
          Manual month-end entries with spreadsheet import and transparent calculated totals.
        </p>
      </div>
      <HistoryManager snapshots={snapshots} />
    </div>
  );
}

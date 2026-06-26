import { getOrderHistory } from "@/features/orders/order.actions";
import OrderHistoryTable from "@/components/OrderHistoryTable";
import { History } from "lucide-react";

export default async function OrdersPage() {
  const orders = await getOrderHistory();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <span className="icon-chip h-11 w-11">
          <History className="h-5 w-5" />
        </span>
        <div>
          <h1 className="page-title">Order history</h1>
          <p className="page-subtitle">All your trades across Zerodha and Alpaca.</p>
        </div>
      </div>

      <OrderHistoryTable orders={orders} />
    </div>
  );
}
